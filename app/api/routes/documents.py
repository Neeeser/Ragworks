from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.db.repositories import ChunkRepository, CollectionRepository, DocumentRepository
from app.schemas.documents import ChunkRead, ChunkVisualization, DocumentRead, IngestionResponse
from app.services.ingestion import IngestionService

router = APIRouter(prefix="/api", tags=["documents"])


def _document_to_schema(document: models.Document) -> DocumentRead:
    return DocumentRead(
        id=document.id,
        collection_id=document.collection_id,
        name=document.name,
        content_type=document.content_type,
        status=document.status,
        num_chunks=document.num_chunks,
        num_tokens=document.num_tokens,
        chunk_size=document.chunk_size,
        chunk_overlap=document.chunk_overlap,
        chunk_strategy=document.chunk_strategy,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.post("/collections/{collection_id}/documents", response_model=IngestionResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    collection_id: UUID,
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> IngestionResponse:
    collection_repo = CollectionRepository(session)
    collection = collection_repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    ingestion_service = IngestionService(session)
    result = ingestion_service.ingest_upload(user=current_user, collection=collection, upload=file)
    document_schema = _document_to_schema(result["document"])
    return IngestionResponse(
        document=document_schema,
        chunk_count=result["chunk_count"],
        pinecone_namespace=result["pinecone_namespace"],
        embedding_model=result["embedding_model"],
        usage=result.get("usage", {}),
    )


@router.get("/collections/{collection_id}/documents", response_model=List[DocumentRead])
def list_documents(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[DocumentRead]:
    collection_repo = CollectionRepository(session)
    collection = collection_repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    repo = DocumentRepository(session)
    documents = repo.list_for_collection(collection_id)
    return [_document_to_schema(doc) for doc in documents]


@router.get("/documents/{document_id}/chunks", response_model=ChunkVisualization)
def get_document_chunks(
    document_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChunkVisualization:
    document = session.get(models.Document, document_id)
    if not document or document.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

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
    return ChunkVisualization(document=_document_to_schema(document), chunks=chunk_schemas)
