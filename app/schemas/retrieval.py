"""Retrieval request and response schema models."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class RetrievedChunk(BaseModel):
    """Chunk returned from a retrieval query."""

    chunk_id: str
    document_id: str
    score: float
    text: str
    metadata: dict[str, Any]


class CollectionQueryRequest(BaseModel):
    """Payload for querying a collection."""

    query: str
    top_k: int = Field(default=5, ge=1)


class CollectionQueryResponse(BaseModel):
    """Response payload for collection queries."""

    query: str
    top_k: int
    chunks: list[RetrievedChunk]
    usage: dict[str, Any]
    query_event_id: UUID | None = None
    pipeline_run_id: UUID | None = None
