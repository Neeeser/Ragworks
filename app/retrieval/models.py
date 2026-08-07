"""Shared retrieval domain models."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.media import InlineMedia

EmbeddingVector = list[float]


class DocumentMetadata(BaseModel):
    """Typed metadata container for documents and chunks."""

    data: dict[str, Any] = Field(default_factory=dict)


class Document(BaseModel):
    """Document payload for ingestion and retrieval."""

    document_id: str
    text: str
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)


class DocumentChunk(BaseModel):
    """Chunked view of a document with optional embedding."""

    document_id: str
    chunk_id: str
    text: str
    order: int
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)
    embedding: EmbeddingVector | None = None

    def with_embedding(self, embedding: EmbeddingVector) -> DocumentChunk:
        """Return a copy of the chunk populated with an embedding."""
        chunk = self.model_copy()
        chunk.embedding = embedding
        return chunk


class IndexMetadata(BaseModel):
    """Vector index configuration details."""

    metric: str = "cosine"
    dimension: int = 384
    namespace: str | None = None
    spec: dict[str, Any] = Field(default_factory=dict)


class ChunkBatch(BaseModel):
    """Batch of chunks prepared for indexing."""

    chunks: Sequence[DocumentChunk]


class QueryRequest(BaseModel):
    """Request data for a vector similarity query."""

    text: str
    top_k: int = 5
    namespace: str | None = None
    filter: dict[str, Any] | None = None


class ScoredChunk(BaseModel):
    """Chunk with a similarity score."""

    chunk: DocumentChunk
    score: float


class RerankCandidate(BaseModel):
    """One match as a reranker reads it: the chunk, plus the image it stands for.

    A chunk carrying only an image indexes under a derived placeholder
    string (`[image: page-12.jpg]`), so a reranker given `match.chunk.text`
    alone scores a filename rather than the page. The bytes travel beside
    the match so a multimodal model scores what the chunk actually is, and
    a text-only model can tell that it was handed something it cannot read.
    """

    match: ScoredChunk
    image: InlineMedia | None = None


class RetrievalResponse(BaseModel):
    """Response payload for retrieval results."""

    matches: list[ScoredChunk]


__all__ = [
    "ChunkBatch",
    "Document",
    "DocumentChunk",
    "DocumentMetadata",
    "EmbeddingVector",
    "IndexMetadata",
    "QueryRequest",
    "RetrievalResponse",
    "ScoredChunk",
]
