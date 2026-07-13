"""Document (ingestion-record) listing and chunk API routes.

Uploads moved to the file-tree routes (`app/api/routes/files.py`); a
document row here is the ingestion record for a file node.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import get_collection_or_404
from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository
from app.schemas.documents import (
    ChunkDetailRead,
    ChunkRead,
    ChunkVisualization,
    DocumentRead,
)

router = APIRouter(prefix="/api", tags=["documents"])


@router.get("/collections/{collection_id}/documents", response_model=list[DocumentRead])
def list_documents(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[DocumentRead]:
    """List documents for a collection."""
    get_collection_or_404(collection_id, current_user.id, session)
    documents = DocumentRepository(session).list_for_collection(collection_id)
    return [DocumentRead.from_model(doc) for doc in documents]


@router.get("/documents/{document_id}/chunks", response_model=ChunkVisualization)
def get_document_chunks(
    document_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChunkVisualization:
    """Return chunk visualization data for a document."""
    document = DocumentRepository(session).get_for_user(document_id, current_user.id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    chunks = ChunkRepository(session).list_for_document(document_id)
    return ChunkVisualization(
        document=DocumentRead.from_model(document),
        chunks=[ChunkRead.from_model(chunk) for chunk in chunks],
    )


@router.get("/chunks/{chunk_id}", response_model=ChunkDetailRead)
def get_chunk_detail(
    chunk_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChunkDetailRead:
    """Return details for a single chunk."""
    chunk = ChunkRepository(session).get(chunk_id)
    if not chunk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chunk not found")
    document = DocumentRepository(session).get_for_user(chunk.document_id, current_user.id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chunk not found")
    return ChunkDetailRead(
        document=DocumentRead.from_model(document),
        chunk=ChunkRead.from_model(chunk),
    )
