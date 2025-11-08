from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.models import ModelInfo
from app.services.openrouter import get_openrouter_client

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelInfo])
def list_models(refresh: bool = Query(False, description="Force refresh of the OpenRouter model catalog")) -> list[ModelInfo]:
    client = get_openrouter_client()
    return client.list_models(force_refresh=refresh)

