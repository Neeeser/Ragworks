"""OpenRouter embeddings client adapter."""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from typing import Optional

from pydantic import ValidationError

from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.schemas.openrouter import OpenRouterEmbeddingItem, OpenRouterEmbeddingsResponse
from app.services.openrouter import OpenRouterClient

logger = logging.getLogger(__name__)


class OpenRouterEmbedder(Embedder):
    """Embedder that delegates to OpenRouter's embeddings endpoint."""

    def __init__(
        self,
        client: OpenRouterClient,
        model_name: str,
        *,
        dimensions: Optional[int] = None,
    ) -> None:
        """Initialize the embedder with an OpenRouter client and model."""
        self._client = client
        self.model_name = model_name
        self.dimensions = dimensions
        self._last_usage: Optional[dict[str, int]] = None

    @property
    def usage(self) -> Optional[dict[str, int]]:
        """Return the most recent usage payload, if available."""
        return self._last_usage

    def _extract_vectors(self, payload: dict[str, object]) -> list[EmbeddingVector]:
        """Parse embedding vectors from a raw OpenRouter payload."""
        parsed: OpenRouterEmbeddingsResponse | None = None
        try:
            parsed = OpenRouterEmbeddingsResponse.model_validate(payload)
        except ValidationError:
            parsed = None

        data = parsed.data if parsed and parsed.data is not None else payload.get("data")
        if not isinstance(data, Iterable) or isinstance(data, (str, bytes)):
            error_detail = payload.get("error") or payload
            logger.error(
                "OpenRouter embeddings payload missing 'data': %s",
                error_detail,
            )
            raise ValueError(
                "OpenRouter returned an embeddings payload without a 'data' array."
            )
        vectors: list[EmbeddingVector] = []
        for index, entry in enumerate(data):
            if isinstance(entry, OpenRouterEmbeddingItem):
                embedding = entry.embedding
            elif isinstance(entry, dict):
                embedding = entry.get("embedding")
            else:
                logger.error(
                    "OpenRouter embeddings payload entry %s is not a mapping: %r",
                    index,
                    entry,
                )
                raise ValueError("OpenRouter returned an invalid embedding entry.")
            if not isinstance(embedding, Iterable) or isinstance(embedding, (str, bytes)):
                logger.error(
                    "OpenRouter embeddings payload entry %s missing 'embedding': %s",
                    index,
                    entry,
                )
                raise ValueError(
                    "OpenRouter returned an embedding entry without 'embedding' values."
                )
            vectors.append([float(value) for value in embedding])
        if parsed and parsed.usage:
            usage_payload = parsed.usage.model_dump(exclude_none=True)
        else:
            usage_payload = payload.get("usage") or {}
        if usage_payload:
            self._last_usage = {
                k: int(v)
                for k, v in usage_payload.items()
                if isinstance(v, (int, float))
            }
        return vectors

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed document chunks using OpenRouter."""
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
        payload = self._client.embed(
            [chunk.text for chunk in chunks],
            model=self.model_name,
            dimensions=self.dimensions,
        )
        logger.debug("OpenRouter embeddings response keys=%s", list(payload.keys()))
        return self._extract_vectors(payload)

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a single query string using OpenRouter."""
        payload = self._client.embed([query], model=self.model_name, dimensions=self.dimensions)
        vectors = self._extract_vectors(payload)
        return vectors[0] if vectors else []
