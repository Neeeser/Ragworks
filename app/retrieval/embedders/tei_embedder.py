"""TEI-backed text embedder."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.tei import TEIClient
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector


class TEIEmbedder(Embedder):
    """Embed text through a TEI server configured for embedding inference."""

    def __init__(self, client: TEIClient, model_name: str) -> None:
        self._client = client
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        """TEI's native embedding endpoint does not report token usage."""
        return None

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed all document chunks, preserving their request order."""
        if not chunks:
            return []
        vectors = self._client.embed([chunk.text for chunk in chunks])
        if len(vectors) != len(chunks):
            raise ValueError("TEI returned a mismatched number of embedding vectors.")
        return vectors

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed one retrieval query."""
        vectors = self._client.embed([query])
        if len(vectors) != 1:
            raise ValueError("TEI must return exactly one embedding vector for a query.")
        return vectors[0]
