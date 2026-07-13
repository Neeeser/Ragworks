"""Ollama embeddings client adapter."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from app.clients.ollama import OllamaClient
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.schemas.ollama import OllamaEmbedResponse

logger = logging.getLogger(__name__)


class OllamaEmbedder(Embedder):
    """Embedder that delegates to an Ollama server's `/api/embed` endpoint."""

    def __init__(
        self,
        client: OllamaClient,
        model_name: str,
        *,
        dimensions: int | None = None,
    ) -> None:
        """Initialize the embedder with an Ollama client and model."""
        self._client = client
        self.model_name = model_name
        self.dimensions = dimensions
        self._last_usage: dict[str, int] | None = None

    @property
    def usage(self) -> dict[str, int] | None:
        """Return the most recent usage payload, if available."""
        return self._last_usage

    def _extract_vectors(self, response: OllamaEmbedResponse) -> list[EmbeddingVector]:
        """Parse embedding vectors and capture usage from a validated response."""
        if response.prompt_eval_count is not None:
            self._last_usage = {
                "prompt_tokens": response.prompt_eval_count,
                "total_tokens": response.prompt_eval_count,
            }
        return [[float(value) for value in vector] for vector in response.embeddings]

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed document chunks using the Ollama server."""
        if not chunks:
            return []
        logger.info(
            "Embedding %s chunk(s) with Ollama model %s", len(chunks), self.model_name
        )
        response = self._client.embed(
            [chunk.text for chunk in chunks],
            model=self.model_name,
            dimensions=self.dimensions,
        )
        vectors = self._extract_vectors(response)
        if len(vectors) != len(chunks):
            raise ValueError("Ollama returned a mismatched number of embeddings.")
        return vectors

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a single query string using the Ollama server."""
        response = self._client.embed(
            [query], model=self.model_name, dimensions=self.dimensions
        )
        vectors = self._extract_vectors(response)
        if not vectors:
            raise ValueError("Ollama returned no embedding for the query.")
        return vectors[0]
