"""Model catalog API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import require_openrouter_key
from app.db import models
from app.schemas.models import (
    EmbeddingDimensionResponse,
    EmbeddingModelInfo,
    EndpointsListResponse,
    ModelInfo,
)
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


@router.get("/embeddings", response_model=list[EmbeddingModelInfo])
def list_embedding_models(
    refresh: bool = Query(
        False,
        description="Force refresh of the OpenRouter embedding model catalog",
    ),
    current_user: models.User = Depends(require_openrouter_key),
) -> list[EmbeddingModelInfo]:
    """List available OpenRouter embedding models."""
    client = get_openrouter_client(current_user.openrouter_api_key or "")
    payload = client.list_embedding_models(force_refresh=refresh)
    models_list: list[EmbeddingModelInfo] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        if not model_id:
            continue
        name = item.get("name") or model_id
        models_list.append(
            EmbeddingModelInfo(
                id=str(model_id),
                name=str(name),
                description=item.get("description"),
                context_length=item.get("context_length"),
                pricing=item.get("pricing"),
            )
        )
    return models_list


@router.get("/embeddings/dimension", response_model=EmbeddingDimensionResponse)
def get_embedding_dimension(
    model: str = Query(..., description="Embedding model id"),
    current_user: models.User = Depends(require_openrouter_key),
) -> EmbeddingDimensionResponse:
    """Return the embedding dimension for a model."""
    client = get_openrouter_client(current_user.openrouter_api_key or "")
    dimension = client.get_embedding_dimension(model)
    return EmbeddingDimensionResponse(model=model, dimension=dimension)
