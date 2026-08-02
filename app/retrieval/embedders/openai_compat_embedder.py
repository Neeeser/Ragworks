"""Embedder over any server serving OpenAI-compatible `/v1/embeddings`.

One implementation serves OpenAI, a vLLM or llama.cpp server, LM Studio, and
anything else in the family, because they share the wire format. The provider
label is injected only so an error message names the thing the user configured
rather than "the embeddings endpoint".
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence

from app.clients.openai_compat import OpenAICompatClient
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.schemas.chat_completions import EmbeddingsResponse
from app.services.errors import ExternalServiceError

logger = logging.getLogger(__name__)


class OpenAICompatEmbedder(Embedder):
    """Embedder that delegates to an OpenAI-compatible embeddings endpoint."""

    def __init__(
        self,
        client: OpenAICompatClient,
        model_name: str,
        *,
        provider_label: str,
        dimensions: int | None = None,
    ) -> None:
        """Bind the embedder to a client, a model, and the label for its errors."""
        self._client = client
        self._provider_label = provider_label
        self.model_name = model_name
        self.dimensions = dimensions
        self._last_usage: dict[str, int] | None = None

    @property
    def usage(self) -> dict[str, int] | None:
        """Return the most recent call's token usage, when reported."""
        return self._last_usage

    def _extract_vectors(self, response: EmbeddingsResponse) -> list[EmbeddingVector]:
        """Read vectors out of a validated embeddings payload."""
        if response.data is None:
            if response.error is not None:
                message = response.error.get("message") or str(response.error)
                logger.error(
                    "%s embeddings request failed: %s", self._provider_label, response.error
                )
                raise ExternalServiceError(
                    f"{self._provider_label} embeddings request failed: {message}"
                )
            raise ExternalServiceError(
                f"{self._provider_label} returned an embeddings payload with no 'data' array."
            )
        vectors: list[EmbeddingVector] = []
        for index, entry in enumerate(response.data):
            embedding = entry.embedding
            if not isinstance(embedding, Iterable) or isinstance(embedding, (str, bytes)):
                logger.error(
                    "%s embeddings entry %s carried no vector", self._provider_label, index
                )
                raise ExternalServiceError(
                    f"{self._provider_label} returned an embedding entry with no values."
                )
            vectors.append([float(value) for value in embedding])
        self._record_usage(response)
        return vectors

    def _record_usage(self, response: EmbeddingsResponse) -> None:
        """Store the numeric usage counters the response reported."""
        if not response.usage:
            return
        payload = response.usage.model_dump(exclude_none=True)
        counters = {
            key: int(value) for key, value in payload.items() if isinstance(value, (int, float))
        }
        if counters:
            self._last_usage = counters

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed document chunks."""
        if not chunks:
            return []
        response = self._client.embed(
            [chunk.text for chunk in chunks],
            model=self.model_name,
            dimensions=self.dimensions,
        )
        return self._extract_vectors(response)

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a single query string."""
        response = self._client.embed([query], model=self.model_name, dimensions=self.dimensions)
        vectors = self._extract_vectors(response)
        return vectors[0] if vectors else []
