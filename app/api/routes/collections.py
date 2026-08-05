"""Collection management API routes.

Routes stay thin: parse input, call one service, shape the response or translate
a domain error. Creation/update/prompt behavior lives in
`app.services.collections.CollectionService`; the deletion cascade in
`app.services.collection_deletion.CollectionDeletionService`.
"""

from __future__ import annotations

import mimetypes
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import collection_to_schema, get_collection_or_404, to_http_exception
from app.db import models
from app.db.repositories import (
    CollectionHistoryRepository,
    CollectionLatencyRepository,
    CollectionRepository,
    CollectionStats,
    CollectionStatsRepository,
)
from app.schemas.collections import (
    CollectionCreate,
    CollectionDeleteResponse,
    CollectionIndexesRead,
    CollectionRead,
    CollectionStatsHistoryRead,
    CollectionStatsRead,
    CollectionUpdate,
)
from app.schemas.prompts import (
    PromptReference,
    PromptSelectionRead,
    PromptSelectionUpdate,
)
from app.services.collection_deletion import CollectionDeletionService
from app.services.collection_history import CollectionHistoryService
from app.services.collection_indexes import CollectionIndexService
from app.services.collections import CollectionService
from app.services.errors import ServiceError
from app.services.files import resolve_collection_asset
from app.utils.file_storage import FileStorage

router = APIRouter(prefix="/api/collections", tags=["collections"])


def _to_schema(session: Session, collection: models.Collection) -> CollectionRead:
    """Convert a collection model into a response schema."""
    return collection_to_schema(session, collection)


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
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[CollectionRead]:
    """List collections owned by the current user."""
    repo = CollectionRepository(session)
    return [_to_schema(session, col) for col in repo.list_for_user(current_user.id)]


@router.get("/stats", response_model=list[CollectionStatsRead])
def list_collection_stats(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[CollectionStatsRead]:
    """Return aggregated stats for all collections."""
    repo = CollectionRepository(session)
    collections = list(repo.list_for_user(current_user.id))
    stats_map = CollectionStatsRepository(session).stats_for(
        current_user.id, [collection.id for collection in collections]
    )
    return [_stats_read(collection.id, stats_map[collection.id]) for collection in collections]


@router.get("/{collection_id}/stats", response_model=CollectionStatsRead)
def get_collection_stats(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionStatsRead:
    """Return aggregated stats for a single collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    stats_map = CollectionStatsRepository(session).stats_for(current_user.id, [collection.id])
    return _stats_read(collection.id, stats_map[collection.id])


@router.get("/{collection_id}/stats/history", response_model=CollectionStatsHistoryRead)
def get_collection_stats_history(
    collection_id: UUID,
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionStatsHistoryRead:
    """Return bucketed activity history over the collection's lifetime or a span.

    Omitting `start`/`end` yields the lifetime domain; supplying both narrows
    to that span. The server always chooses the bucket width and echoes the
    resolved domain back.
    """
    collection = get_collection_or_404(collection_id, current_user.id, session)
    service = CollectionHistoryService(
        CollectionHistoryRepository(session),
        CollectionLatencyRepository(session),
    )
    try:
        return service.history_for(
            user_id=current_user.id,
            collection_id=collection.id,
            collection_created_at=collection.created_at,
            start=start,
            end=end,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/{collection_id}", response_model=CollectionRead)
def get_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Return a collection by id."""
    return _to_schema(session, get_collection_or_404(collection_id, current_user.id, session))


@router.get("/{collection_id}/prompt", response_model=PromptSelectionRead)
def get_collection_prompt(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptSelectionRead:
    """Return the collection's tool prompt selection and its rendering."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return CollectionService(session).prompt_read(collection, current_user)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/{collection_id}/indexes", response_model=CollectionIndexesRead)
def get_collection_indexes(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionIndexesRead:
    """Report the indexes this collection's bound pipelines name."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    return CollectionIndexService(session).read(current_user, collection)


@router.post("", response_model=CollectionRead, status_code=201)
def create_collection(
    payload: CollectionCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Create a new collection for the current user."""
    try:
        collection = CollectionService(session).create(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _to_schema(session, collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
def update_collection(
    collection_id: UUID,
    payload: CollectionUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Update collection metadata for the current user."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        collection = CollectionService(session).update(collection, payload, current_user)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _to_schema(session, collection)


@router.patch("/{collection_id}/prompt", response_model=PromptSelectionRead)
def update_collection_prompt(
    collection_id: UUID,
    payload: PromptSelectionUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptSelectionRead:
    """Point the collection's tool prompt at a library prompt."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    reference = PromptReference(prompt_id=payload.prompt_id, version=payload.version)
    try:
        return CollectionService(session).update_prompt(collection, current_user, reference)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/{collection_id}", response_model=CollectionDeleteResponse, status_code=200)
def delete_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionDeleteResponse:
    """Delete a collection and its associated vectors, files, and rows."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        CollectionDeletionService(session).delete(current_user, collection)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return CollectionDeleteResponse()


@router.get("/{collection_id}/assets/{asset_path:path}")
def get_collection_asset(
    collection_id: UUID,
    asset_path: str,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileResponse:
    """Stream a stored asset a retrieval match references (an indexed image).

    The path is the storage-relative one carried on the match's
    `ragworks.image_asset` metadata; the service scopes it to this
    collection's directory.
    """
    get_collection_or_404(collection_id, current_user.id, session)
    try:
        resolved = resolve_collection_asset(FileStorage(), collection_id, asset_path)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    media_type, _ = mimetypes.guess_type(resolved.name)
    return FileResponse(
        path=resolved,
        media_type=media_type or "application/octet-stream",
        headers={
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )
