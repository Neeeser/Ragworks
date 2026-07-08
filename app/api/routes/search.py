"""Search API routes for retrieval queries."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_session, require_openrouter_key
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.schemas.retrieval import CollectionQueryRequest, CollectionQueryResponse
from app.services.errors import ServiceError
from app.services.retrieval import RetrievalService

router = APIRouter(prefix="/api/collections", tags=["search"])


@router.post("/{collection_id}/query", response_model=CollectionQueryResponse)
def run_collection_query(
    collection_id: UUID,
    payload: CollectionQueryRequest,
    current_user: models.User = Depends(require_openrouter_key),
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
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
