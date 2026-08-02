"""Unified model catalog API routes (all provider connections)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.schemas.enums import ProviderKind
from app.schemas.model_shortlist import (
    ModelShortlistEntry,
    ModelShortlistIdentity,
    ModelShortlistResponse,
)
from app.schemas.models import EndpointsListResponse
from app.schemas.providers import EmbeddingDimensionResponse, ModelCatalogResponse
from app.services.errors import ServiceError
from app.services.model_catalog import (
    list_models_for_user,
    list_openrouter_model_endpoints,
    resolve_embedding_dimension,
)
from app.services.model_shortlist import ModelShortlistService

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models", response_model=ModelCatalogResponse)
def list_models(
    kind: ProviderKind = Query(
        ProviderKind.CHAT,
        description="Which model kind to list (chat or embedding)",
    ),
    refresh: bool = Query(False, description="Wait for fresh provider catalogs"),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ModelCatalogResponse:
    """List models of one kind across every capable provider connection."""
    try:
        return list_models_for_user(session, current_user, kind, force_refresh=refresh)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/models/shortlist", response_model=ModelShortlistResponse)
def get_model_shortlist(
    kind: ProviderKind = Query(
        ProviderKind.CHAT, description="Which model kind's shortlist to read"
    ),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ModelShortlistResponse:
    """List the caller's pinned and recently used models for one kind."""
    try:
        return ModelShortlistService(session).list_shortlist(current_user, kind)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.put("/models/shortlist/pins", response_model=ModelShortlistEntry)
def pin_model(
    identity: ModelShortlistIdentity,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ModelShortlistEntry:
    """Pin a model so it leads the picker. Pinning twice is the same state."""
    try:
        return ModelShortlistService(session).pin(current_user, identity)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/models/shortlist/pins", status_code=status.HTTP_204_NO_CONTENT)
def unpin_model(
    identity: ModelShortlistIdentity,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    """Remove a pin."""
    try:
        ModelShortlistService(session).unpin(current_user, identity)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/models/shortlist/recents", response_model=ModelShortlistEntry)
def record_model_use(
    identity: ModelShortlistIdentity,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ModelShortlistEntry:
    """Record that a model was selected, bumping it to the top of recents."""
    try:
        return ModelShortlistService(session).record_use(current_user, identity)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get(
    "/connections/{connection_id}/models/{author}/{slug}/endpoints",
    response_model=EndpointsListResponse,
)
def list_model_endpoints(
    connection_id: UUID,
    author: str,
    slug: str,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EndpointsListResponse:
    """List OpenRouter's per-provider endpoints for a model (OpenRouter connections only)."""
    try:
        return list_openrouter_model_endpoints(session, current_user, connection_id, author, slug)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get(
    "/connections/{connection_id}/models/embedding-dimension",
    response_model=EmbeddingDimensionResponse,
)
def get_embedding_dimension(
    connection_id: UUID,
    model_id: str = Query(..., min_length=1),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EmbeddingDimensionResponse:
    """Resolve one embedding model's dimension for an exact connection."""
    try:
        return resolve_embedding_dimension(session, current_user, connection_id, model_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
