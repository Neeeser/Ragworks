"""Cohere retrieval embedder with query/document input type separation."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.cohere import CohereClient
from app.clients.cohere.schemas import CohereEmbedResponse
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector

_MAX_TEXTS_PER_REQUEST = 96


class CohereEmbedder(Embedder):
    """Embed documents and queries through Cohere's v2 embed endpoint."""

    def __init__(
        self, client: CohereClient, model_name: str, *, dimensions: int | None = None
    ) -> None:
        """Bind a Cohere model and optional v4 output dimension."""
        self._client = client
        self.model_name = model_name
        self.dimensions = dimensions
        self._last_usage: dict[str, int] | None = None

    @property
    def usage(self) -> dict[str, int] | None:
        """Return usage from the most recent Cohere embedding request."""
        return self._last_usage

    def _extract_vectors(self, response: CohereEmbedResponse) -> list[EmbeddingVector]:
        """Read float vectors from a typed Cohere response."""
        return [[float(value) for value in vector] for vector in response.embeddings.values]

    @staticmethod
    def _input_tokens(response: CohereEmbedResponse) -> int | None:
        """Return billed input tokens when Cohere included usage metadata."""
        usage = response.meta.billed_units if response.meta else None
        return usage.input_tokens if usage else None

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed chunks as searchable documents."""
        if not chunks:
            return []
        all_vectors: list[EmbeddingVector] = []
        total_input_tokens = 0
        has_usage = False
        for start in range(0, len(chunks), _MAX_TEXTS_PER_REQUEST):
            batch = chunks[start : start + _MAX_TEXTS_PER_REQUEST]
            response = self._client.embed(
                [chunk.text for chunk in batch],
                model=self.model_name,
                input_type="search_document",
                output_dimension=self.dimensions,
            )
            vectors = self._extract_vectors(response)
            if len(vectors) != len(batch):
                raise ValueError("Cohere returned a mismatched number of embeddings.")
            all_vectors.extend(vectors)
            input_tokens = self._input_tokens(response)
            if input_tokens is not None:
                total_input_tokens += input_tokens
                has_usage = True
        self._last_usage = (
            {
                "prompt_tokens": total_input_tokens,
                "total_tokens": total_input_tokens,
            }
            if has_usage
            else None
        )
        return all_vectors

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a query with Cohere's retrieval-query input type."""
        response = self._client.embed(
            [query],
            model=self.model_name,
            input_type="search_query",
            output_dimension=self.dimensions,
        )
        vectors = self._extract_vectors(response)
        if not vectors:
            raise ValueError("Cohere returned no embedding for the query.")
        input_tokens = self._input_tokens(response)
        self._last_usage = (
            {"prompt_tokens": input_tokens, "total_tokens": input_tokens}
            if input_tokens is not None
            else None
        )
        return vectors[0]
