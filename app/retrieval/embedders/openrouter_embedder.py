"""OpenRouter embeddings client adapter."""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence

from app.clients.openrouter import OpenRouterClient
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.schemas.openrouter import OpenRouterEmbeddingsResponse
from app.services.errors import ExternalServiceError

logger = logging.getLogger(__name__)


class OpenRouterEmbedder(Embedder):
    """Embedder that delegates to OpenRouter's embeddings endpoint."""

    def __init__(
        self,
        client: OpenRouterClient,
        model_name: str,
        *,
        dimensions: int | None = None,
    ) -> None:
        """Initialize the embedder with an OpenRouter client and model."""
        self._client = client
        self.model_name = model_name
        self.dimensions = dimensions
        self._last_usage: dict[str, int] | None = None

    @property
    def usage(self) -> dict[str, int] | None:
        """Return the most recent usage payload, if available."""
        return self._last_usage

    def _extract_vectors(self, response: OpenRouterEmbeddingsResponse) -> list[EmbeddingVector]:
        """Parse embedding vectors from a validated OpenRouter embeddings response.

        `response` is already schema-validated by `OpenRouterClient.embed` — no
        isinstance ladder is needed here for the envelope or entry shape, only
        for the `embedding` field itself (typed `Any` on the schema since
        OpenRouter's actual payload always carries a list of floats, but the
        schema doesn't pin that down).
        """
        data = response.data
        if data is None:
            if response.error is not None:
                # The envelope carried a provider error instead of vectors --
                # surface it as the external failure it is (502, with the
                # provider's own message) rather than an internal ValueError.
                message = (
                    response.error.get("message")
                    if isinstance(response.error, dict)
                    else str(response.error)
                )
                logger.error("OpenRouter embeddings request failed: %s", response.error)
                raise ExternalServiceError(f"OpenRouter embeddings request failed: {message}")
            logger.error("OpenRouter embeddings response missing 'data': %s", response)
            raise ValueError(
                "OpenRouter returned an embeddings payload without a 'data' array."
            )
        vectors: list[EmbeddingVector] = []
        for index, entry in enumerate(data):
            embedding = entry.embedding
            if not isinstance(embedding, Iterable) or isinstance(embedding, (str, bytes)):
                logger.error(
                    "OpenRouter embeddings response entry %s missing 'embedding': %s",
                    index,
                    entry,
                )
                raise ValueError(
                    "OpenRouter returned an embedding entry without 'embedding' values."
                )
            vectors.append([float(value) for value in embedding])
        if response.usage:
            usage_payload = response.usage.model_dump(exclude_none=True)
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
        response = self._client.embed(
            [chunk.text for chunk in chunks],
            model=self.model_name,
            dimensions=self.dimensions,
        )
        logger.debug("OpenRouter embeddings response model=%s", response.model)
        return self._extract_vectors(response)

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a single query string using OpenRouter."""
        response = self._client.embed([query], model=self.model_name, dimensions=self.dimensions)
        vectors = self._extract_vectors(response)
        return vectors[0] if vectors else []
