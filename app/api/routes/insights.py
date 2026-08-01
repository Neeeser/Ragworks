"""Collection insight routes: overview, map, graph, overlaps, probe, refresh."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.schemas.insights import (
    InsightClusterRead,
    InsightDocEdgeRead,
    InsightDocPointRead,
    InsightGraphRead,
    InsightMapRead,
    InsightOverlapRead,
    InsightOverlapsRead,
    InsightOverviewRead,
    InsightPointRead,
    InsightProbeMatchRead,
    InsightProbeRead,
    InsightProbeRequest,
    InsightSnapshotRead,
    OverlapSideRead,
    collapse_snippet,
)
from app.services.app_config import get_app_config
from app.services.errors import ServiceError
from app.visualization.insights.probe import probe_query
from app.visualization.insights.service import InsightService
from app.visualization.insights.tasks import schedule_insight_refresh


def require_insights_enabled() -> None:
    """Gate every route on this router behind the insights feature flag.

    404, not 403: a disabled feature is indistinguishable from an absent
    one -- the common OSS shape for feature-flagged routes.
    """
    if not get_app_config().features.collection_insights:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


router = APIRouter(
    prefix="/api/collections",
    tags=["insights"],
    dependencies=[Depends(require_insights_enabled)],
)


def _overview(service: InsightService, collection_id: UUID) -> InsightOverviewRead:
    ready, active = service.overview(collection_id)
    return InsightOverviewRead(
        snapshot=InsightSnapshotRead.from_model(ready) if ready else None,
        active=InsightSnapshotRead.from_model(active) if active else None,
        chunk_total=service.chunk_total(collection_id),
        can_compute=service.can_compute(collection_id),
    )


@router.get("/{collection_id}/insights", response_model=InsightOverviewRead)
def get_insight_overview(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InsightOverviewRead:
    """Snapshot state for the page chrome; never computes anything."""
    collection = get_collection_or_404(
        collection_id=collection_id, user_id=current_user.id, session=session
    )
    return _overview(InsightService(session), collection.id)


@router.post("/{collection_id}/insights/refresh", response_model=InsightOverviewRead)
def refresh_insights(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InsightOverviewRead:
    """Queue a background refresh (first build, catch-up, or refit).

    Idempotent: a refresh already in flight makes this a no-op, and a
    collection without enough chunks returns its overview unchanged
    (`can_compute` says why nothing started).
    """
    collection = get_collection_or_404(
        collection_id=collection_id, user_id=current_user.id, session=session
    )
    schedule_insight_refresh(collection.id, current_user.id)
    return _overview(InsightService(session), collection.id)


@router.get("/{collection_id}/insights/map", response_model=InsightMapRead)
def get_insight_map(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InsightMapRead:
    """Every placed chunk, document aggregate, and labelled cluster."""
    collection = get_collection_or_404(
        collection_id=collection_id, user_id=current_user.id, session=session
    )
    service = InsightService(session)
    try:
        snapshot = service.ready_snapshot(collection.id)
        points, documents, clusters = service.map_data(snapshot)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return InsightMapRead(
        snapshot=InsightSnapshotRead.from_model(snapshot),
        points=[
            InsightPointRead(
                id=point.id,
                chunk_id=point.chunk_id,
                document_id=point.document_id,
                document_name=name,
                chunk_index=point.chunk_index,
                x=point.x,
                y=point.y,
                cluster_index=point.cluster_index,
            )
            for point, name in points
        ],
        documents=[_doc_point(point, name) for point, name in documents],
        clusters=[
            InsightClusterRead(
                cluster_index=cluster.cluster_index,
                label=cluster.label,
                size=cluster.size,
                x=cluster.x,
                y=cluster.y,
            )
            for cluster in clusters
        ],
    )


@router.get("/{collection_id}/insights/graph", response_model=InsightGraphRead)
def get_insight_graph(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InsightGraphRead:
    """Document nodes and exact-similarity edges."""
    collection = get_collection_or_404(
        collection_id=collection_id, user_id=current_user.id, session=session
    )
    service = InsightService(session)
    try:
        snapshot = service.ready_snapshot(collection.id)
        documents, edges = service.graph_data(snapshot)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return InsightGraphRead(
        snapshot=InsightSnapshotRead.from_model(snapshot),
        documents=[_doc_point(point, name) for point, name in documents],
        edges=[
            InsightDocEdgeRead(
                source_document_id=edge.source_document_id,
                target_document_id=edge.target_document_id,
                similarity=edge.similarity,
                collision_count=edge.collision_count,
            )
            for edge in edges
        ],
    )


@router.get("/{collection_id}/insights/overlaps", response_model=InsightOverlapsRead)
def get_insight_overlaps(
    collection_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InsightOverlapsRead:
    """Ranked cross-document chunk pairs retrieval is likely to confuse."""
    collection = get_collection_or_404(
        collection_id=collection_id, user_id=current_user.id, session=session
    )
    service = InsightService(session)
    try:
        snapshot = service.ready_snapshot(collection.id)
        pairs = service.overlaps(snapshot, limit)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return InsightOverlapsRead(
        snapshot=InsightSnapshotRead.from_model(snapshot),
        pairs=[
            InsightOverlapRead(
                similarity=row.neighbor.similarity,
                a=OverlapSideRead(
                    chunk_id=row.neighbor.chunk_id,
                    document_id=row.neighbor.document_id,
                    document_name=row.document_name,
                    chunk_index=row.chunk_index,
                    text_snippet=collapse_snippet(row.text_snippet),
                ),
                b=OverlapSideRead(
                    chunk_id=row.neighbor.neighbor_chunk_id,
                    document_id=row.neighbor.neighbor_document_id,
                    document_name=row.neighbor_document_name,
                    chunk_index=row.neighbor_chunk_index,
                    text_snippet=collapse_snippet(row.neighbor_text_snippet),
                ),
            )
            for row in pairs
        ],
    )


@router.post("/{collection_id}/insights/probe", response_model=InsightProbeRead)
def probe_insights(
    collection_id: UUID,
    payload: InsightProbeRequest = Body(...),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InsightProbeRead:
    """Drop a query onto the map and rank the chunks nearest to it."""
    collection = get_collection_or_404(
        collection_id=collection_id, user_id=current_user.id, session=session
    )
    try:
        snapshot, result = probe_query(session, current_user, collection, payload.query)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return InsightProbeRead(
        x=result.x,
        y=result.y,
        space=snapshot.space,
        space_label=snapshot.space_label,
        matches=[InsightProbeMatchRead(**match._asdict()) for match in result.matches],
    )


def _doc_point(point: models.InsightDocPointRecord, name: str) -> InsightDocPointRead:
    return InsightDocPointRead(
        document_id=point.document_id,
        document_name=name,
        x=point.x,
        y=point.y,
        chunk_count=point.chunk_count,
    )
