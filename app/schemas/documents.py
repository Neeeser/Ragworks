"""Document and chunk schema models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from pydantic import BaseModel

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import ChunkStrategy, DocumentStatus

if TYPE_CHECKING:
    from app.db.models import Document, DocumentChunkRecord


class DocumentRead(DateTimeConfigMixin, BaseModel):
    """Document details returned to API clients."""

    id: UUID
    collection_id: UUID
    file_id: UUID | None = None
    name: str
    content_type: str
    status: DocumentStatus
    error_message: str | None = None
    num_chunks: int
    num_tokens: int
    chunk_size: int
    chunk_overlap: int
    chunk_strategy: ChunkStrategy
    ingestion_run_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, document: Document) -> DocumentRead:
        """Build a schema instance from a document model."""
        return cls(
            id=document.id,
            collection_id=document.collection_id,
            file_id=document.file_id,
            name=document.name,
            content_type=document.content_type,
            status=document.status,
            error_message=document.error_message,
            num_chunks=document.num_chunks,
            num_tokens=document.num_tokens,
            chunk_size=document.chunk_size,
            chunk_overlap=document.chunk_overlap,
            chunk_strategy=document.chunk_strategy,
            ingestion_run_id=document.ingestion_run_id,
            created_at=document.created_at,
            updated_at=document.updated_at,
        )


class ChunkRead(DateTimeConfigMixin, BaseModel):
    """Chunk details returned to API clients."""

    id: UUID
    document_id: UUID
    chunk_index: int
    text: str
    metadata: dict[str, Any]
    chunk_size: int
    chunk_strategy: ChunkStrategy
    created_at: datetime

    @classmethod
    def from_model(cls, chunk: DocumentChunkRecord) -> ChunkRead:
        """Build a schema instance from a stored chunk record."""
        return cls(
            id=chunk.id,
            document_id=chunk.document_id,
            chunk_index=chunk.chunk_index,
            text=chunk.text,
            metadata=chunk.chunk_metadata,
            chunk_size=chunk.chunk_size,
            chunk_strategy=chunk.chunk_strategy,
            created_at=chunk.created_at,
        )


class ChunkVisualization(BaseModel):
    """Response payload for chunk visualization views."""

    document: DocumentRead
    chunks: list[ChunkRead]


class ChunkDetailRead(BaseModel):
    """Response payload for a single chunk detail view."""

    document: DocumentRead
    chunk: ChunkRead


