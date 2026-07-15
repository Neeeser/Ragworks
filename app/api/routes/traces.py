"""Trace API routes for pipeline execution visibility."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.schemas.traces import (
    DocumentTraceResponse,
    EndToEndTraceResponse,
    PipelineTraceResponse,
)
from app.services.traces import TraceNotFoundError, TraceService

router = APIRouter(prefix="/api", tags=["traces"])


@router.get("/pipeline-runs/{run_id}", response_model=PipelineTraceResponse)
def get_pipeline_run_trace(
    run_id: UUID,
    current_user: models.User = Depends(get_current_user),
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
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineTraceResponse:
    """Return the ingestion trace for a document."""
    try:
        return TraceService(session).get_document_trace(document_id, current_user.id)
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/documents/{document_id}/trace/full", response_model=DocumentTraceResponse)
def get_document_focused_trace(
    document_id: UUID,
    chunk_id: str | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> DocumentTraceResponse:
    """Return the ingestion trace with one chunk resolved for focus."""
    try:
        return TraceService(session).get_document_focused_trace(
            document_id, current_user.id, chunk_id=chunk_id
        )
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/query-events/{query_event_id}/trace", response_model=PipelineTraceResponse)
def get_query_event_trace(
    query_event_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PipelineTraceResponse:
    """Return the retrieval trace for a query event."""
    try:
        return TraceService(session).get_query_event_trace(query_event_id, current_user.id)
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/query-events/{query_event_id}/trace/full", response_model=EndToEndTraceResponse)
def get_query_event_end_to_end_trace(
    query_event_id: UUID,
    chunk_id: str | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EndToEndTraceResponse:
    """Return the retrieval trace joined with the chunk's ingestion trace."""
    try:
        return TraceService(session).get_query_event_end_to_end_trace(
            query_event_id, current_user.id, chunk_id=chunk_id
        )
    except TraceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
