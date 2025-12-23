"""Search API routes for retrieval queries."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.api.routes.utils import get_collection_or_404
from app.schemas.retrieval import CollectionQueryRequest, CollectionQueryResponse
from app.services.retrieval import RetrievalService

router = APIRouter(prefix="/api/collections", tags=["search"])


@router.post("/{collection_id}/query", response_model=CollectionQueryResponse)
def run_collection_query(
    collection_id: UUID,
    payload: CollectionQueryRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionQueryResponse:
    """Run a retrieval query against a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    retrieval_service = RetrievalService(session)
    return retrieval_service.query_collection(
        current_user,
        collection,
        query=payload.query,
        top_k=payload.top_k,
    )
