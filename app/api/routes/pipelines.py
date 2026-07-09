"""Pipeline management API routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator
from app.schemas.pipelines import (
    NodeSpecRead,
    PipelineActivateRequest,
    PipelineChangeRead,
    PipelineCreate,
    PipelineDeleteResponse,
    PipelineNodesResponse,
    PipelineRead,
    PipelineUpdate,
    PipelineValidationResponse,
    PipelineVersionRead,
)
from app.services.errors import ServiceError
from app.services.pipelines import PipelineService

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])


def get_pipeline_or_404(
    pipeline_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> models.Pipeline:
    """Return a pipeline owned by the current user, or raise a 404."""
    pipeline = PipelineService(session).get_pipeline(pipeline_id, current_user.id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")
    return pipeline


def _to_pipeline_read(
    pipeline: models.Pipeline,
    definition: PipelineDefinition,
) -> PipelineRead:
    """Convert a pipeline model + its resolved definition into a response schema.

    `definition` lives on the pipeline's current `PipelineVersion`, not on
    `models.Pipeline` itself, so the row is dumped to a dict and the definition
    merged in before validation instead of listed field-by-field.

    `warnings=False` on the dump: `table=True` models skip validation, so
    enum-typed columns (`kind`) hold the raw DB string and pydantic's
    serializer would warn on every request despite the value being exactly
    what `model_validate` below expects -- that validation is the real gate.
    """
    data = pipeline.model_dump(warnings=False)
    return PipelineRead.model_validate({**data, "definition": definition})


def _validate_definition_or_400(definition: PipelineDefinition) -> None:
    """Validate a pipeline definition and raise an HTTP error on failure."""
    validator = PipelineValidator(default_registry())
    result = validator.validate(definition)
    if not result.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"errors": result.errors},
        )


@router.get("/nodes", response_model=PipelineNodesResponse)
def list_pipeline_nodes(
    _current_user: models.User = Depends(get_current_user),
) -> PipelineNodesResponse:
    """Return pipeline node definitions for the editor."""
    registry = default_registry()
    return PipelineNodesResponse(
        nodes=[NodeSpecRead.model_validate(spec, from_attributes=True) for spec in registry.specs()]
    )


@router.post("/validate", response_model=PipelineValidationResponse)
def validate_pipeline(
    definition: PipelineDefinition,
    _current_user: models.User = Depends(get_current_user),
) -> PipelineValidationResponse:
    """Validate a pipeline definition."""
    registry = default_registry()
    validator = PipelineValidator(registry)
    result = validator.validate(definition)
    return PipelineValidationResponse(
        valid=result.valid,
        errors=result.errors,
        warnings=result.warnings,
    )


@router.get("", response_model=list[PipelineRead])
def list_pipelines(
    kind: models.PipelineKind | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[PipelineRead]:
    """List pipelines for the current user."""
    service = PipelineService(session)
    pipelines = service.list_pipelines(current_user.id, kind=kind)
    return [
        _to_pipeline_read(pipeline, service.get_definition(pipeline))
        for pipeline in pipelines
    ]


@router.post("", response_model=PipelineRead, status_code=status.HTTP_201_CREATED)
def create_pipeline(
    payload: PipelineCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Create a new pipeline for the current user."""
    _validate_definition_or_400(payload.definition)
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=current_user,
        name=payload.name,
        description=payload.description,
        kind=payload.kind,
        definition=payload.definition,
        change_summary=payload.change_summary,
    )
    session.commit()
    session.refresh(pipeline)
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.get("/{pipeline_id}", response_model=PipelineRead)
def get_pipeline(
    pipeline: models.Pipeline = Depends(get_pipeline_or_404),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Return a pipeline by id."""
    service = PipelineService(session)
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.patch("/{pipeline_id}", response_model=PipelineRead)
def update_pipeline(
    payload: PipelineUpdate,
    pipeline: models.Pipeline = Depends(get_pipeline_or_404),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Update pipeline metadata or definition."""
    service = PipelineService(session)
    if payload.definition is not None:
        _validate_definition_or_400(payload.definition)
    try:
        service.update_pipeline(
            pipeline=pipeline,
            name=payload.name,
            description=payload.description,
            definition=payload.definition,
            change_summary=payload.change_summary,
            actor_id=current_user.id,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    session.commit()
    session.refresh(pipeline)
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.get("/{pipeline_id}/versions", response_model=list[PipelineVersionRead])
def list_pipeline_versions(
    pipeline: models.Pipeline = Depends(get_pipeline_or_404),
    session: Session = Depends(get_session),
) -> list[PipelineVersionRead]:
    """List versions for a pipeline, each with its diff against the prior version."""
    service = PipelineService(session)
    versions = service.list_versions_with_changes(pipeline)
    return [
        PipelineVersionRead(
            id=version.id,
            pipeline_id=version.pipeline_id,
            version=version.version,
            created_at=version.created_at,
            updated_at=version.updated_at,
            change_summary=version.change_summary,
            created_by=version.created_by,
            changes=[
                PipelineChangeRead(kind=change.kind, summary=change.summary)
                for change in changes
            ],
        )
        for version, changes in versions
    ]


@router.post("/{pipeline_id}/activate", response_model=PipelineRead)
def activate_pipeline_version(
    payload: PipelineActivateRequest,
    pipeline: models.Pipeline = Depends(get_pipeline_or_404),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Activate a pipeline version."""
    service = PipelineService(session)
    try:
        service.activate_version(pipeline, payload.version)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    session.commit()
    session.refresh(pipeline)
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.delete("/{pipeline_id}", response_model=PipelineDeleteResponse)
def delete_pipeline(
    pipeline: models.Pipeline = Depends(get_pipeline_or_404),
    session: Session = Depends(get_session),
) -> PipelineDeleteResponse:
    """Delete a pipeline when it is not referenced by collections."""
    service = PipelineService(session)
    if service.pipeline_in_use(pipeline.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pipeline is in use by one or more collections.",
        )
    service.delete_pipeline(pipeline)
    session.commit()
    return PipelineDeleteResponse()
