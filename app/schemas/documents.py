from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel

from app.db.models import ChunkStrategy, DocumentStatus


class DocumentRead(BaseModel):
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
    created_at: datetime
    updated_at: datetime


class ChunkRead(BaseModel):
    id: UUID
    document_id: UUID
    chunk_index: int
    text: str
    metadata: Dict[str, Any]
    chunk_size: int
    chunk_strategy: ChunkStrategy
    created_at: datetime


class ChunkVisualization(BaseModel):
    document: DocumentRead
    chunks: List[ChunkRead]


class IngestionResponse(BaseModel):
    document: DocumentRead
    chunk_count: int
    pinecone_namespace: str
    embedding_model: str
    usage: Dict[str, int]
