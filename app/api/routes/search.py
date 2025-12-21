from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.db.repositories import CollectionRepository
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
    repo = CollectionRepository(session)
    collection = repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    retrieval_service = RetrievalService()
    return retrieval_service.query_collection(collection, query=payload.query, top_k=payload.top_k)
