"""Pipeline management API routes."""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.pipelines.models import PipelineDefinition
from app.pipelines.registry import build_default_registry
from app.pipelines.runtime import PipelineValidator
from app.schemas.pipelines import (
    PipelineActivateRequest,
    PipelineCreate,
    PipelineDeleteResponse,
    PipelineNodesResponse,
    PipelineRead,
    PipelineUpdate,
    PipelineValidationResponse,
    PipelineVersionRead,
)
from app.services.pipelines import PipelineService

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])


def _to_pipeline_read(
    pipeline: models.Pipeline,
    definition: PipelineDefinition,
) -> PipelineRead:
    """Convert a pipeline model into a response schema."""
    return PipelineRead(
        id=pipeline.id,
        user_id=pipeline.user_id,
        name=pipeline.name,
        description=pipeline.description,
        kind=pipeline.kind,
        current_version=pipeline.current_version,
        is_default=pipeline.is_default,
        created_at=pipeline.created_at,
        updated_at=pipeline.updated_at,
        definition=definition,
    )


def _validate_definition_or_400(definition: PipelineDefinition) -> None:
    """Validate a pipeline definition and raise an HTTP error on failure."""
    validator = PipelineValidator(build_default_registry())
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
    registry = build_default_registry()
    return PipelineNodesResponse(nodes=registry.specs())


@router.post("/validate", response_model=PipelineValidationResponse)
def validate_pipeline(
    definition: PipelineDefinition,
    _current_user: models.User = Depends(get_current_user),
) -> PipelineValidationResponse:
    """Validate a pipeline definition."""
    registry = build_default_registry()
    validator = PipelineValidator(registry)
    result = validator.validate(definition)
    return PipelineValidationResponse(
        valid=result.valid,
        errors=result.errors,
        warnings=result.warnings,
    )


@router.get("", response_model=List[PipelineRead])
def list_pipelines(
    kind: Optional[models.PipelineKind] = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[PipelineRead]:
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
    pipeline_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Return a pipeline by id."""
    service = PipelineService(session)
    pipeline = service.get_pipeline(pipeline_id, current_user.id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.patch("/{pipeline_id}", response_model=PipelineRead)
def update_pipeline(
    pipeline_id: UUID,
    payload: PipelineUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Update pipeline metadata or definition."""
    service = PipelineService(session)
    pipeline = service.get_pipeline(pipeline_id, current_user.id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")
    if payload.definition is not None:
        _validate_definition_or_400(payload.definition)
    service.update_pipeline(
        pipeline=pipeline,
        name=payload.name,
        description=payload.description,
        definition=payload.definition,
        change_summary=payload.change_summary,
        actor_id=current_user.id,
    )
    session.commit()
    session.refresh(pipeline)
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.get("/{pipeline_id}/versions", response_model=List[PipelineVersionRead])
def list_pipeline_versions(
    pipeline_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[PipelineVersionRead]:
    """List versions for a pipeline."""
    service = PipelineService(session)
    pipeline = service.get_pipeline(pipeline_id, current_user.id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")
    versions = service.list_versions(pipeline)
    return [
        PipelineVersionRead(
            id=version.id,
            pipeline_id=version.pipeline_id,
            version=version.version,
            created_at=version.created_at,
            updated_at=version.updated_at,
            change_summary=version.change_summary,
            created_by=version.created_by,
        )
        for version in versions
    ]


@router.post("/{pipeline_id}/activate", response_model=PipelineRead)
def activate_pipeline_version(
    pipeline_id: UUID,
    payload: PipelineActivateRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineRead:
    """Activate a pipeline version."""
    service = PipelineService(session)
    pipeline = service.get_pipeline(pipeline_id, current_user.id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")
    try:
        service.activate_version(pipeline, payload.version)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    session.commit()
    session.refresh(pipeline)
    definition = service.get_definition(pipeline)
    return _to_pipeline_read(pipeline, definition)


@router.delete("/{pipeline_id}", response_model=PipelineDeleteResponse)
def delete_pipeline(
    pipeline_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineDeleteResponse:
    """Delete a pipeline when it is not referenced by collections."""
    service = PipelineService(session)
    pipeline = service.get_pipeline(pipeline_id, current_user.id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")
    if service.pipeline_in_use(pipeline.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pipeline is in use by one or more collections.",
        )
    service.delete_pipeline(pipeline)
    session.commit()
    return PipelineDeleteResponse()
