"""Model catalog API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import require_openrouter_key
from app.db import models
from app.schemas.models import EndpointsListResponse, ModelInfo
from app.services.openrouter import get_openrouter_client

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelInfo])
def list_models(
    refresh: bool = Query(
        False,
        description="Force refresh of the OpenRouter model catalog",
    ),
    current_user: models.User = Depends(require_openrouter_key),
) -> list[ModelInfo]:
    """List available OpenRouter models."""
    client = get_openrouter_client(current_user.openrouter_api_key or "")
    return client.list_models(force_refresh=refresh)


@router.get("/{author}/{slug}/endpoints", response_model=EndpointsListResponse)
def list_model_endpoints(
    author: str,
    slug: str,
    current_user: models.User = Depends(require_openrouter_key),
) -> EndpointsListResponse:
    """List endpoints for a specific OpenRouter model."""
    client = get_openrouter_client(current_user.openrouter_api_key or "")
    return client.list_model_endpoints(author, slug)
