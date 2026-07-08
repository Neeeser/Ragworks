"""Collection management API routes.

Routes stay thin: parse input, call one service, shape the response or translate
a domain error. Creation/update/prompt behavior lives in
`app.services.collections.CollectionService`; the deletion cascade in
`app.services.collection_deletion.CollectionDeletionService`.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_session, require_openrouter_key
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.db.repositories import CollectionRepository, CollectionStats
from app.schemas.collections import (
    CollectionCreate,
    CollectionDeleteResponse,
    CollectionPromptRead,
    CollectionPromptUpdate,
    CollectionRead,
    CollectionStatsRead,
    CollectionUpdate,
)
from app.services.collection_deletion import CollectionDeletionService
from app.services.collections import CollectionService
from app.services.errors import ServiceError

router = APIRouter(prefix="/api/collections", tags=["collections"])


def _to_schema(collection: models.Collection) -> CollectionRead:
    """Convert a collection model into a response schema."""
    return CollectionRead(
        id=collection.id,
        user_id=collection.user_id,
        name=collection.name,
        description=collection.description,
        ingestion_pipeline_id=collection.ingestion_pipeline_id,
        retrieval_pipeline_id=collection.retrieval_pipeline_id,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        metadata=collection.extra_metadata,
    )


def _stats_read(collection_id: UUID, stats: CollectionStats) -> CollectionStatsRead:
    """Convert repository stats into the wire schema."""
    return CollectionStatsRead(
        collection_id=collection_id,
        document_count=stats.document_count,
        chunk_count=stats.chunk_count,
        average_latency_ms=stats.average_latency_ms,
        last_used_at=stats.last_used_at,
    )


@router.get("", response_model=list[CollectionRead])
def list_collections(
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> list[CollectionRead]:
    """List collections owned by the current user."""
    repo = CollectionRepository(session)
    return [_to_schema(col) for col in repo.list_for_user(current_user.id)]


@router.get("/stats", response_model=list[CollectionStatsRead])
def list_collection_stats(
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> list[CollectionStatsRead]:
    """Return aggregated stats for all collections."""
    repo = CollectionRepository(session)
    collections = list(repo.list_for_user(current_user.id))
    stats_map = repo.stats_for(current_user.id, [collection.id for collection in collections])
    return [_stats_read(collection.id, stats_map[collection.id]) for collection in collections]


@router.get("/{collection_id}/stats", response_model=CollectionStatsRead)
def get_collection_stats(
    collection_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionStatsRead:
    """Return aggregated stats for a single collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    stats_map = CollectionRepository(session).stats_for(current_user.id, [collection.id])
    return _stats_read(collection.id, stats_map[collection.id])


@router.get("/{collection_id}", response_model=CollectionRead)
def get_collection(
    collection_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Return a collection by id."""
    return _to_schema(get_collection_or_404(collection_id, current_user.id, session))


@router.get("/{collection_id}/prompt", response_model=CollectionPromptRead)
def get_collection_prompt(
    collection_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionPromptRead:
    """Return the rendered system prompt for a collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return CollectionService(session).prompt_read(collection, current_user)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("", response_model=CollectionRead, status_code=201)
def create_collection(
    payload: CollectionCreate,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Create a new collection for the current user."""
    try:
        collection = CollectionService(session).create(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _to_schema(collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
def update_collection(
    collection_id: UUID,
    payload: CollectionUpdate,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Update collection metadata for the current user."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        collection = CollectionService(session).update(collection, payload, current_user)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _to_schema(collection)


@router.patch("/{collection_id}/prompt", response_model=CollectionPromptRead)
def update_collection_prompt(
    collection_id: UUID,
    payload: CollectionPromptUpdate,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionPromptRead:
    """Update the system prompt template for a collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return CollectionService(session).update_prompt(collection, current_user, payload.template)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/{collection_id}", response_model=CollectionDeleteResponse, status_code=200)
def delete_collection(
    collection_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> CollectionDeleteResponse:
    """Delete a collection and its associated vectors, files, and rows."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        CollectionDeletionService(session).delete(current_user, collection)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return CollectionDeleteResponse()
