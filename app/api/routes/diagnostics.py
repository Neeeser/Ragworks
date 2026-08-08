"""Collection diagnostics endpoint."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.schemas.diagnostics import (
    CollectionDiagnosticsPreviewRequest,
    CollectionDiagnosticsResponse,
    DiagnosticsSummary,
)
from app.services.diagnostics import CollectionDiagnosticsService
from app.services.errors import ServiceError

router = APIRouter(prefix="/api/collections", tags=["diagnostics"])


@router.post("/diagnostics/preview", response_model=DiagnosticsSummary)
def preview_collection_diagnostics(
    payload: CollectionDiagnosticsPreviewRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> DiagnosticsSummary:
    """Return diagnostics for a collection configuration before it is created."""
    try:
        return CollectionDiagnosticsService(session).preview(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/{collection_id}/diagnostics", response_model=CollectionDiagnosticsResponse)
def get_collection_diagnostics(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionDiagnosticsResponse:
    """Return cross-pipeline compatibility diagnostics for a collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return CollectionDiagnosticsService(session).run(current_user, collection)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
