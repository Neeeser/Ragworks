"""Cached catalog of OpenRouter models and embedding models.

Owns the shape-by-convention caching and dimension-probing logic that used to
live directly on `OpenRouterClient`. Transport (the actual OpenRouter HTTP
calls) is injected as callables so this class holds only caching/shaping
logic, no I/O of its own -- `OpenRouterClient` owns the `httpx.Client`/SDK
client and supplies the fetch/probe callables at construction time.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from app.cache import CachePolicy, CacheSnapshot, ValueCache
from app.schemas.models import EmbeddingModelInfo, ModelInfo
from app.schemas.openrouter import OpenRouterEmbeddingsResponse

_CATALOG_POLICY = CachePolicy(
    fresh_seconds=300,
    max_stale_seconds=900,
    failure_retry_seconds=30,
    max_entries=1,
)


class ModelCatalog:
    """Cache OpenRouter listings without eagerly probing embedding models."""

    def __init__(
        self,
        fetch_models: Callable[[], list[ModelInfo]],
        fetch_embedding_models: Callable[[], list[EmbeddingModelInfo]],
        probe_embedding: Callable[[str], OpenRouterEmbeddingsResponse],
    ) -> None:
        """Store the injected fetch/probe callables and initialize empty caches."""
        self._fetch_models = fetch_models
        self._fetch_embedding_models = fetch_embedding_models
        self._probe_embedding = probe_embedding
        self._models = ValueCache[str, list[ModelInfo]](_CATALOG_POLICY)
        self._embedding_models = ValueCache[str, list[EmbeddingModelInfo]](
            _CATALOG_POLICY
        )

    def list_models(self, force_refresh: bool = False) -> CacheSnapshot[list[ModelInfo]]:
        """Return available models with cache freshness metadata."""
        return self._models.get(
            "models", self._fetch_models, force_refresh=force_refresh
        )

    def list_embedding_models(
        self, force_refresh: bool = False
    ) -> CacheSnapshot[list[EmbeddingModelInfo]]:
        """Return embedding models without loading them to discover dimensions."""
        return self._embedding_models.get(
            "embedding", self._fetch_embedding_models, force_refresh=force_refresh
        )

    def get_embedding_dimension(self, model_id: str) -> int:
        """Return the embedding dimension for `model_id` by probing OpenRouter."""
        if not model_id:
            raise ValueError("Embedding model id must be provided.")
        response = self._probe_embedding(model_id)
        if not response.data:
            raise ValueError("OpenRouter embeddings response missing data array.")
        embedding = response.data[0].embedding
        if not isinstance(embedding, Iterable) or isinstance(embedding, (str, bytes)):
            raise ValueError("OpenRouter embeddings response missing embedding values.")
        return len(list(embedding))

    def close(self) -> None:
        """Wait for catalog refreshes before the owning transport closes."""
        self._models.close()
        self._embedding_models.close()
