"""Visualization API routes for collection analytics."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_session, require_user_api_keys
from app.api.routes.utils import get_collection_or_404
from app.db import models
from app.schemas.visualization import (
    UmapComputeRequest,
    UmapPointRead,
    UmapProjectionRead,
    UmapVisualizationRead,
)
from app.visualization.umap.service import UmapConfig, UmapService

router = APIRouter(prefix="/api/collections", tags=["visualizations"])


@router.get("/{collection_id}/visualizations/umap", response_model=UmapVisualizationRead)
def get_collection_umap(
    collection_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> UmapVisualizationRead:
    """Return the latest UMAP projection for a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    service = UmapService(session)
    try:
        projection, points = service.get_latest_projection(collection.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return UmapVisualizationRead(
        projection=UmapProjectionRead.from_model(projection),
        points=[UmapPointRead.from_model(point) for point in points],
    )


@router.post("/{collection_id}/visualizations/umap", response_model=UmapVisualizationRead)
def compute_collection_umap(
    collection_id: UUID,
    payload: UmapComputeRequest = Body(default_factory=UmapComputeRequest),
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> UmapVisualizationRead:
    """Compute and persist a UMAP projection for a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    service = UmapService(session)
    config = UmapConfig(**payload.model_dump())
    try:
        projection, points = service.compute_projection(current_user, collection, config)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return UmapVisualizationRead(
        projection=UmapProjectionRead.from_model(projection),
        points=[UmapPointRead.from_model(point) for point in points],
    )
