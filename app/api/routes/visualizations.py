"""Visualization API routes for collection analytics."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_session, require_openrouter_key
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.schemas.visualization import (
    UmapComputeRequest,
    UmapPointRead,
    UmapProjectionRead,
    UmapVisualizationRead,
)
from app.services.app_config import get_app_config
from app.services.errors import ServiceError
from app.visualization.umap.service import UmapConfig, UmapService


def require_umap_enabled() -> None:
    """Gate every route on this router behind the UMAP feature flag.

    404, not 403: a disabled feature is indistinguishable from an absent
    one -- the common OSS shape for feature-flagged routes.
    """
    if not get_app_config().features.umap_visualizations:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


router = APIRouter(
    prefix="/api/collections",
    tags=["visualizations"],
    dependencies=[Depends(require_umap_enabled)],
)


@router.get("/{collection_id}/visualizations/umap", response_model=UmapVisualizationRead)
def get_collection_umap(
    collection_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
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
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return UmapVisualizationRead(
        projection=UmapProjectionRead.from_model(projection),
        points=[UmapPointRead.from_model(point) for point in points],
    )


@router.post("/{collection_id}/visualizations/umap", response_model=UmapVisualizationRead)
def compute_collection_umap(
    collection_id: UUID,
    payload: UmapComputeRequest = Body(default_factory=UmapComputeRequest),
    current_user: models.User = Depends(require_openrouter_key),
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
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return UmapVisualizationRead(
        projection=UmapProjectionRead.from_model(projection),
        points=[UmapPointRead.from_model(point) for point in points],
    )
