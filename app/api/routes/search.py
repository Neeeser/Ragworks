"""Search API routes for retrieval queries."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.schemas.retrieval import (
    CollectionQueryArgumentsResponse,
    CollectionQueryRequest,
    CollectionQueryResponse,
)
from app.services.errors import ServiceError
from app.services.retrieval import RetrievalService
from app.services.tool_invocation import RetrievalPipelineError

router = APIRouter(prefix="/api/collections", tags=["search"])


@router.post("/{collection_id}/query", response_model=CollectionQueryResponse)
def run_collection_query(
    collection_id: UUID,
    payload: CollectionQueryRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionQueryResponse:
    """Run a retrieval query against a collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return RetrievalService(session).query_collection(
            current_user,
            collection,
            query=payload.query,
            top_k=payload.top_k,
            arguments=payload.arguments,
        )
    except RetrievalPipelineError as exc:
        # Persist the failed run so its trace link (`pipeline_run_id`) resolves:
        # the request session otherwise rolls back on the raised error and the
        # run row is lost. A transaction poisoned by a DB-shape error (e.g. a
        # dimension mismatch) can't commit — that rare case has no trace, and
        # the Diagnostics tab is the fix surface there.
        try:
            session.commit()
        except Exception:  # pylint: disable=broad-exception-caught
            session.rollback()
        raise to_http_exception(exc) from exc
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get(
    "/{collection_id}/query-arguments",
    response_model=CollectionQueryArgumentsResponse,
)
def read_collection_query_arguments(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionQueryArgumentsResponse:
    """Return the declared input arguments of the collection's retrieval pipeline."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return RetrievalService(session).query_arguments(current_user, collection)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
