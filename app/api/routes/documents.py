"""Document ingestion and listing API routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlmodel import Session

from app.api.dependencies import get_session, require_user_api_keys
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository
from app.schemas.documents import (
    ChunkDetailRead,
    ChunkRead,
    ChunkVisualization,
    DocumentRead,
    IngestionResponse,
)
from app.services.app_config import get_app_config
from app.services.errors import ServiceError
from app.services.ingestion import IngestionService

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
    collection = get_collection_or_404(collection_id, current_user.id, session)
    upload_config = get_app_config().uploads
    content_type = file.content_type or "text/plain"
    if content_type not in upload_config.allowed_content_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Content type {content_type} is not allowed.",
        )
    # `UploadFile.size` (Starlette) can be None depending on the transport;
    # the cap is best-effort here and falls through when unavailable -- the
    # content-type check above still applies regardless.
    max_bytes = upload_config.max_upload_size_mb * 1024 * 1024
    if file.size is not None and file.size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Upload exceeds the maximum size of {upload_config.max_upload_size_mb}MB.",
        )
    try:
        return IngestionService(session).ingest_upload(
            user=current_user,
            collection=collection,
            filename=file.filename,
            content_type=file.content_type,
            stream=file.file,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/collections/{collection_id}/documents", response_model=list[DocumentRead])
def list_documents(
    collection_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> list[DocumentRead]:
    """List documents for a collection."""
    get_collection_or_404(collection_id, current_user.id, session)
    documents = DocumentRepository(session).list_for_collection(collection_id)
    return [DocumentRead.from_model(doc) for doc in documents]


@router.get("/documents/{document_id}/chunks", response_model=ChunkVisualization)
def get_document_chunks(
    document_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
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
    current_user: models.User = Depends(require_user_api_keys),
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
