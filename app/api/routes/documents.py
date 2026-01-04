"""Document ingestion and listing API routes."""

from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlmodel import Session

from app.api.dependencies import get_session, require_user_api_keys
from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository
from app.schemas.documents import (
    ChunkDetailRead,
    ChunkRead,
    ChunkVisualization,
    DocumentRead,
    IngestionResponse,
)
from app.services.ingestion import IngestionService
from app.api.routes.utils import get_collection_or_404

router = APIRouter(prefix="/api", tags=["documents"])


@router.post(
    "/collections/{collection_id}/documents",
    response_model=IngestionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    collection_id: UUID,
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> IngestionResponse:
    """Upload and ingest a document into a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )

    ingestion_service = IngestionService(session)
    return ingestion_service.ingest_upload(user=current_user, collection=collection, upload=file)


@router.get("/collections/{collection_id}/documents", response_model=List[DocumentRead])
def list_documents(
    collection_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> List[DocumentRead]:
    """List documents for a collection."""
    get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )

    repo = DocumentRepository(session)
    documents = repo.list_for_collection(collection_id)
    return [DocumentRead.from_model(doc) for doc in documents]


@router.get("/documents/{document_id}/chunks", response_model=ChunkVisualization)
def get_document_chunks(
    document_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> ChunkVisualization:
    """Return chunk visualization data for a document."""
    document = session.get(models.Document, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    chunk_repo = ChunkRepository(session)
    chunks = chunk_repo.list_for_document(document_id)
    chunk_schemas = [
        ChunkRead(
            id=chunk.id,
            document_id=chunk.document_id,
            chunk_index=chunk.chunk_index,
            text=chunk.text,
            metadata=chunk.chunk_metadata,
            chunk_size=chunk.chunk_size,
            chunk_strategy=chunk.chunk_strategy,
            created_at=chunk.created_at,
        )
        for chunk in chunks
    ]
    return ChunkVisualization(document=DocumentRead.from_model(document), chunks=chunk_schemas)


@router.get("/chunks/{chunk_id}", response_model=ChunkDetailRead)
def get_chunk_detail(
    chunk_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> ChunkDetailRead:
    """Return details for a single chunk."""
    chunk = session.get(models.DocumentChunkRecord, chunk_id)
    if not chunk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chunk not found",
        )
    document = session.get(models.Document, chunk.document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chunk not found",
        )
    chunk_schema = ChunkRead(
        id=chunk.id,
        document_id=chunk.document_id,
        chunk_index=chunk.chunk_index,
        text=chunk.text,
        metadata=chunk.chunk_metadata,
        chunk_size=chunk.chunk_size,
        chunk_strategy=chunk.chunk_strategy,
        created_at=chunk.created_at,
    )
    return ChunkDetailRead(
        document=DocumentRead.from_model(document),
        chunk=chunk_schema,
    )
