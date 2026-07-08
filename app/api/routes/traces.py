"""Trace API routes for pipeline execution visibility."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_session, require_openrouter_key
from app.db import models
from app.schemas.traces import PipelineTraceResponse
from app.services.traces import TraceNotFoundError, TraceService

router = APIRouter(prefix="/api", tags=["traces"])


@router.get("/pipeline-runs/{run_id}", response_model=PipelineTraceResponse)
def get_pipeline_run_trace(
    run_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> PipelineTraceResponse:
    """Return the trace for a pipeline run."""
    try:
        return TraceService(session).get_run_trace(run_id, current_user.id)
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/documents/{document_id}/trace", response_model=PipelineTraceResponse)
def get_document_trace(
    document_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> PipelineTraceResponse:
    """Return the ingestion trace for a document."""
    try:
        return TraceService(session).get_document_trace(document_id, current_user.id)
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/query-events/{query_event_id}/trace", response_model=PipelineTraceResponse)
def get_query_event_trace(
    query_event_id: UUID,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> PipelineTraceResponse:
    """Return the retrieval trace for a query event."""
    try:
        return TraceService(session).get_query_event_trace(query_event_id, current_user.id)
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
