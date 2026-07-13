"""Unified model catalog API routes (all provider connections)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.schemas.enums import ProviderKind
from app.schemas.models import EndpointsListResponse
from app.schemas.providers import ModelCatalogResponse
from app.services.errors import ServiceError
from app.services.model_catalog import (
    list_models_for_user,
    list_openrouter_model_endpoints,
)

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models", response_model=ModelCatalogResponse)
def list_models(
    kind: ProviderKind = Query(
        ProviderKind.CHAT,
        description="Which model kind to list (chat or embedding)",
    ),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ModelCatalogResponse:
    """List models of one kind across every capable provider connection."""
    try:
        return list_models_for_user(session, current_user, kind)
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
