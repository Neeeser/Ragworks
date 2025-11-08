from __future__ import annotations

from typing import Iterable, Optional, Sequence

from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.services.openrouter import OpenRouterClient


class OpenRouterEmbedder(Embedder):
    """Embedder that delegates to OpenRouter's embeddings endpoint."""

    def __init__(self, client: OpenRouterClient, model_name: str) -> None:
        self._client = client
        self.model_name = model_name
        self._last_usage: Optional[dict[str, int]] = None

    @property
    def usage(self) -> Optional[dict[str, int]]:
        return self._last_usage

    def _extract_vectors(self, payload: dict[str, object]) -> list[EmbeddingVector]:
        data = payload.get("data", [])
        vectors: list[EmbeddingVector] = []
        for entry in data:
            embedding = entry.get("embedding", [])
            vectors.append(list(embedding))
        usage = payload.get("usage") or {}
        if usage:
            self._last_usage = {k: int(v) for k, v in usage.items() if isinstance(v, (int, float))}
        return vectors

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        if not chunks:
            return []
        payload = self._client.embed([chunk.text for chunk in chunks], model=self.model_name)
        return self._extract_vectors(payload)

    def embed_query(self, query: str) -> EmbeddingVector:
        payload = self._client.embed([query], model=self.model_name)
        vectors = self._extract_vectors(payload)
        return vectors[0] if vectors else []

