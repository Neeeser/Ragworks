"""Shared helpers for API route modules."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository, CollectionRepository
from app.schemas.collections import CollectionRead, CollectionToolBindingRead
from app.schemas.pipelines import PipelineValidationIssueRead
from app.services.errors import (
    ExternalServiceError,
    NotFoundError,
    ServiceError,
)


def collection_to_schema(session: Session, collection: models.Collection) -> CollectionRead:
    """Convert a collection row (plus its bindings) into its wire schema.

    Field-by-field on purpose: the db column `extra_metadata` maps to the
    schema field `metadata`, so `model_validate(from_attributes=...)` cannot
    build this shape. Bindings ride along as identity-only summaries; the
    full tool projection is the tools endpoint's job.
    """
    bindings = CollectionPipelineBindingRepository(session).list_for_collection(
        collection.id
    )
    ingest = next(
        (b for b in bindings if b.role == models.BindingRole.INGEST),
        None,
    )
    return CollectionRead(
        id=collection.id,
        user_id=collection.user_id,
        name=collection.name,
        description=collection.description,
        ingest_pipeline_id=ingest.pipeline_id if ingest else None,
        tools=[
            CollectionToolBindingRead(
                id=binding.id,
                pipeline_id=binding.pipeline_id,
                is_primary=binding.is_primary,
                enabled=binding.enabled,
                position=binding.position,
            )
            for binding in bindings
            if binding.role == models.BindingRole.TOOL
        ],
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        metadata=collection.extra_metadata,
    )


def validation_issue_to_schema(issue: object) -> PipelineValidationIssueRead:
    """Map an engine validation issue to its schemas-owned wire model."""
    return PipelineValidationIssueRead.model_validate(issue, from_attributes=True)


def get_collection_or_404(
    collection_id: UUID,
    user_id: UUID,
    session: Session,
) -> models.Collection:
    """Return a collection or raise a 404 HTTPException."""
    repo = CollectionRepository(session)
    collection = repo.get(collection_id, user_id=user_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )
    return collection


def to_http_exception(exc: ServiceError) -> HTTPException:
    """Translate a domain error into its HTTP equivalent for a route to raise.

    The single mapping every route shares: `NotFoundError` -> 404,
    `ExternalServiceError` -> 502, and any other `ServiceError`
    (`InvalidInputError` and the base) -> 400. A `status_code` pinned on the
    error wins over the type mapping (retrieval failures pin 502 vs 500 while
    carrying structured detail). `detail` is passed through verbatim, so
    structured per-field error maps survive to the client.
    """
    if exc.status_code is not None:
        code = exc.status_code
    elif isinstance(exc, NotFoundError):
        code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, ExternalServiceError):
        code = status.HTTP_502_BAD_GATEWAY
    else:
        code = status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=code, detail=exc.detail)
