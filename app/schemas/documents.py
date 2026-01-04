"""Document and chunk schema models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from pydantic import BaseModel

from app.db.models import ChunkStrategy, Document, DocumentStatus
from app.schemas.base import DateTimeConfigMixin


class DocumentRead(DateTimeConfigMixin, BaseModel):
    """Document details returned to API clients."""

    id: UUID
    collection_id: UUID
    name: str
    content_type: str
    status: DocumentStatus
    num_chunks: int
    num_tokens: int
    chunk_size: int
    chunk_overlap: int
    chunk_strategy: ChunkStrategy
    ingestion_run_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, document: Document) -> "DocumentRead":
        """Build a schema instance from a document model."""
        return cls(
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
    metadata: Dict[str, Any]
    chunk_size: int
    chunk_strategy: ChunkStrategy
    created_at: datetime


class ChunkVisualization(BaseModel):
    """Response payload for chunk visualization views."""

    document: DocumentRead
    chunks: List[ChunkRead]


class ChunkDetailRead(BaseModel):
    """Response payload for a single chunk detail view."""

    document: DocumentRead
    chunk: ChunkRead


class IngestionResponse(BaseModel):
    """Response payload for ingestion completion."""

    document: DocumentRead
    chunk_count: int
    pinecone_namespace: str
    embedding_model: str
    usage: Dict[str, int]
