from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from typing import Optional

from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.services.openrouter import OpenRouterClient

logger = logging.getLogger(__name__)


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
        data = payload.get("data")
        if not isinstance(data, Iterable) or isinstance(data, (str, bytes)):
            error_detail = payload.get("error") or payload
            logger.error("OpenRouter embeddings payload missing 'data': %s", error_detail)
            raise ValueError("OpenRouter returned an embeddings payload without a 'data' array.")
        vectors: list[EmbeddingVector] = []
        for index, entry in enumerate(data):
            if not isinstance(entry, dict):
                logger.error("OpenRouter embeddings payload entry %s is not a mapping: %r", index, entry)
                raise ValueError("OpenRouter returned an invalid embedding entry.")
            embedding = entry.get("embedding")
            if not isinstance(embedding, Iterable) or isinstance(embedding, (str, bytes)):
                logger.error("OpenRouter embeddings payload entry %s missing 'embedding': %s", index, entry)
                raise ValueError("OpenRouter returned an embedding entry without 'embedding' values.")
            vectors.append([float(value) for value in embedding])
        usage = payload.get("usage") or {}
        if usage:
            self._last_usage = {k: int(v) for k, v in usage.items() if isinstance(v, (int, float))}
        return vectors

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        if not chunks:
            return []
        chunk_lengths = [len(chunk.text or "") for chunk in chunks]
        first_chunk_len = chunk_lengths[0] if chunk_lengths else 0
        logger.info(
            "Embedding %s chunk(s) with model %s (first chunk chars=%s, chunk length sample=%s)",
            len(chunks),
            self.model_name,
            first_chunk_len,
            chunk_lengths[:5],
        )
        logger.debug(
            "Embedding chunk ids preview=%s",
            [chunk.chunk_id for chunk in chunks[:5]],
        )
        payload = self._client.embed([chunk.text for chunk in chunks], model=self.model_name)
        logger.debug("OpenRouter embeddings response keys=%s", list(payload.keys()))
        return self._extract_vectors(payload)

    def embed_query(self, query: str) -> EmbeddingVector:
        payload = self._client.embed([query], model=self.model_name)
        vectors = self._extract_vectors(payload)
        return vectors[0] if vectors else []
