"""TTL-cached catalog of OpenRouter models and embedding models.

Owns the shape-by-convention caching and dimension-probing logic that used to
live directly on `OpenRouterClient`. Transport (the actual OpenRouter HTTP
calls) is injected as callables so this class holds only caching/shaping
logic, no I/O of its own -- `OpenRouterClient` owns the `httpx.Client`/SDK
client and supplies the fetch/probe callables at construction time.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable

from pydantic import ValidationError

from app.schemas.models import EmbeddingModelInfo, ModelInfo
from app.schemas.openrouter import OpenRouterEmbeddingsResponse

_CACHE_TTL_SECONDS = 300.0


class ModelCatalog:
    """Caches OpenRouter model/embedding-model listings for `_CACHE_TTL_SECONDS`.

    `list_embedding_models` enriches each entry with a probed embedding
    dimension, caching dimensions by model id indefinitely (a model's vector
    size never changes) separately from the listing TTL.
    """

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
        self._models: list[ModelInfo] = []
        self._models_ts = 0.0
        self._embedding_models: list[EmbeddingModelInfo] = []
        self._embedding_models_ts = 0.0
        self._dimensions: dict[str, int] = {}

    def list_models(self, force_refresh: bool = False) -> list[ModelInfo]:
        """Return available models, caching for `_CACHE_TTL_SECONDS`."""
        now = time.time()
        if not force_refresh and now - self._models_ts < _CACHE_TTL_SECONDS and self._models:
            return self._models
        self._models = self._fetch_models()
        self._models_ts = now
        return self._models

    def list_embedding_models(self, force_refresh: bool = False) -> list[EmbeddingModelInfo]:
        """Return embedding models enriched with probed dimensions.

        Caches the enriched listing for `_CACHE_TTL_SECONDS`; a model whose
        dimension probe fails is still returned, with `dimension=None`.
        """
        now = time.time()
        if (
            not force_refresh
            and now - self._embedding_models_ts < _CACHE_TTL_SECONDS
            and self._embedding_models
        ):
            return self._embedding_models
        enriched: list[EmbeddingModelInfo] = []
        for model in self._fetch_embedding_models():
            dimension = self._dimensions.get(model.id)
            if dimension is None:
                try:
                    dimension = self.get_embedding_dimension(model.id)
                    self._dimensions[model.id] = dimension
                except (ValueError, ValidationError):
                    dimension = None
            enriched.append(model.model_copy(update={"dimension": dimension}))
        self._embedding_models = enriched
        self._embedding_models_ts = now
        return self._embedding_models

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
