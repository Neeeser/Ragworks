"""OpenRouter client built on the shared OpenAI-compatible transport.

OpenRouter speaks the Chat Completions dialect, so chat, embeddings, and
reranking are the shared implementations in `app/clients/openai_compat/` rather
than a second copy. What is genuinely OpenRouter's own lives here: the
attribution headers it asks integrators to send, its far richer `/models`
metadata (per-model `supported_parameters` and pricing, which no other
OpenAI-compatible server publishes), and the `/key` account endpoint.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Any
from urllib.parse import quote

from app.cache import CacheSnapshot, ResourceCache
from app.clients.openai_compat import ChatCall, OpenAICompatClient, TransportConfig
from app.clients.openrouter.catalog import ModelCatalog
from app.core.config import get_settings
from app.schemas.chat_completions import (
    ChatCompletionChunk,
    ChatCompletionResponse,
    EmbeddingsResponse,
    RerankDocument,
    RerankResponse,
)
from app.schemas.media import InlineMedia
from app.schemas.models import EmbeddingModelInfo, EndpointsListResponse, ModelInfo
from app.schemas.openrouter import OpenRouterKeyInfo


class OpenRouterClient:
    """Typed access to one OpenRouter account."""

    def __init__(self, api_key: str) -> None:
        """Open the shared transport with OpenRouter's attribution headers."""
        resolved_key = (api_key or "").strip()
        if not resolved_key:
            raise ValueError("OpenRouter API key must be provided.")
        self.api_key = resolved_key
        self.settings = get_settings()
        self.compat = OpenAICompatClient(
            TransportConfig(
                base_url=self.settings.openrouter_base_url,
                api_key=resolved_key,
                headers=self._app_headers(),
            )
        )
        self._catalog = ModelCatalog(
            fetch_models=self._fetch_models,
            fetch_embedding_models=self._fetch_embedding_models,
            fetch_rerank_models=self._fetch_rerank_models,
            probe_embedding=self._probe_embedding_dimension,
        )

    def _app_headers(self) -> tuple[tuple[str, str], ...]:
        """Build the static attribution headers OpenRouter asks for."""
        headers = [("X-Title", self.settings.openrouter_site_name or "Ragworks")]
        if self.settings.openrouter_site_url:
            headers.append(("HTTP-Referer", self.settings.openrouter_site_url))
        return tuple(headers)

    def _get_json(self, path: str) -> dict[str, Any]:
        """GET an OpenRouter REST path and return its decoded object body."""
        payload = self.compat.request_json("GET", path)
        return payload if isinstance(payload, dict) else {}

    def _fetch_models(self) -> list[ModelInfo]:
        """Fetch the full chat-model list with OpenRouter's per-model metadata."""
        payload = self._get_json("/models")
        raw = payload.get("data")
        if not isinstance(raw, list):
            return []
        return [ModelInfo(**item) for item in raw if isinstance(item, dict)]

    @staticmethod
    def _modality_list(architecture: dict[str, Any], key: str) -> list[str]:
        """Read one modality list off an `architecture` block."""
        values = architecture.get(key)
        if not isinstance(values, list):
            return []
        return [str(value) for value in values if isinstance(value, str)]

    def _fetch_embedding_models(self) -> list[EmbeddingModelInfo]:
        """Fetch the embedding-model list (no dimensions — those need a probe)."""
        payload = self._get_json("/embeddings/models")
        raw = payload.get("data")
        if not isinstance(raw, list):
            return []
        models: list[EmbeddingModelInfo] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id")
            if not model_id:
                continue
            top_provider = item.get("top_provider")
            max_input_tokens = (
                top_provider.get("context_length") if isinstance(top_provider, dict) else None
            )
            architecture = item.get("architecture")
            architecture = architecture if isinstance(architecture, dict) else {}
            models.append(
                EmbeddingModelInfo(
                    id=str(model_id),
                    name=str(item.get("name") or model_id),
                    description=item.get("description"),
                    context_length=item.get("context_length"),
                    max_input_tokens=max_input_tokens,
                    pricing=item.get("pricing"),
                    input_modalities=self._modality_list(architecture, "input_modalities"),
                    output_modalities=self._modality_list(architecture, "output_modalities"),
                )
            )
        return models

    def _fetch_rerank_models(self) -> list[ModelInfo]:
        """Fetch reranking models from the filtered unified catalog."""
        payload = self._get_json("/models?output_modalities=rerank")
        raw = payload.get("data")
        if not isinstance(raw, list):
            return []
        return [ModelInfo.model_validate(item) for item in raw if isinstance(item, dict)]

    def _probe_embedding_dimension(self, model_id: str) -> EmbeddingsResponse:
        """Issue a single-input embeddings call used to measure vector length."""
        return self.embed(["dimension_probe"], model=model_id)

    def chat(self, call: ChatCall) -> ChatCompletionResponse:
        """Request a buffered chat completion."""
        return self.compat.chat(call)

    def chat_stream(self, call: ChatCall) -> Iterator[ChatCompletionChunk]:
        """Yield streaming chat-completion chunks."""
        return self.compat.chat_stream(call)

    def embed(
        self,
        texts: Iterable[str],
        model: str,
        dimensions: int | None = None,
    ) -> EmbeddingsResponse:
        """Create embeddings for the provided texts."""
        return self.compat.embed(texts, model=model, dimensions=dimensions)

    def embed_media(
        self,
        media: Iterable[InlineMedia],
        *,
        model: str,
        dimensions: int | None = None,
    ) -> EmbeddingsResponse:
        """Create embeddings for inline media (images)."""
        return self.compat.embed_media(media, model=model, dimensions=dimensions)

    def rerank(
        self, *, model: str, query: str, documents: list[RerankDocument]
    ) -> RerankResponse:
        """Score every supplied document against a query."""
        return self.compat.rerank(model=model, query=query, documents=documents)

    def list_models(self, force_refresh: bool = False) -> CacheSnapshot[list[ModelInfo]]:
        """Return available models, caching for a short period."""
        return self._catalog.list_models(force_refresh=force_refresh)

    def list_embedding_models(
        self, force_refresh: bool = False
    ) -> CacheSnapshot[list[EmbeddingModelInfo]]:
        """Return available embedding models, caching for a short period."""
        return self._catalog.list_embedding_models(force_refresh=force_refresh)

    def list_embedding_model_metadata(
        self,
        force_refresh: bool = False,
    ) -> CacheSnapshot[list[EmbeddingModelInfo]]:
        """Return embedding model limits without dimension-probe API calls."""
        return self._catalog.list_embedding_models(force_refresh=force_refresh)

    def list_rerank_models(self, force_refresh: bool = False) -> CacheSnapshot[list[ModelInfo]]:
        """Return available reranking models with cache metadata."""
        return self._catalog.list_rerank_models(force_refresh=force_refresh)

    def get_embedding_dimension(self, model_id: str) -> int:
        """Return embedding dimension for the requested model."""
        return self._catalog.get_embedding_dimension(model_id)

    def get_current_key(self) -> OpenRouterKeyInfo:
        """Return metadata for the currently authenticated API key."""
        return OpenRouterKeyInfo.model_validate(self._get_json("/key"))

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Find a model by id or canonical slug."""
        if not model_id:
            return None

        def _match(models: list[ModelInfo]) -> ModelInfo | None:
            """Return the first model that matches by id or slug."""
            for model in models:
                if model_id in (model.id, model.canonical_slug):
                    return model
            normalized = model_id.lower()
            for model in models:
                canonical = model.canonical_slug
                if model.id.lower() == normalized or (
                    canonical and canonical.lower() == normalized
                ):
                    return model
            return None

        match = _match(self.list_models().value)
        if match:
            return match
        return _match(self.list_models(force_refresh=True).value)

    def list_model_endpoints(self, author: str, slug: str) -> EndpointsListResponse:
        """Return endpoint listings for a given model author/slug."""
        author_segment = quote(author, safe="")
        slug_segment = quote(slug, safe="")
        payload = self._get_json(f"/models/{author_segment}/{slug_segment}/endpoints")
        return EndpointsListResponse(**payload)

    def close(self) -> None:
        """Close the catalog refreshers and the shared transport."""
        self._catalog.close()
        self.compat.close()


_client_cache: ResourceCache[str, OpenRouterClient] = ResourceCache(
    max_entries=64, key_material=lambda key: key
)


def get_openrouter_client(api_key: str) -> OpenRouterClient:
    """Return a cached OpenRouter client instance, closing clients it evicts.

    Cached by raw API key so a given user's requests reuse one HTTP connection
    pool; the cache is bounded and closes whatever it evicts, so a stale key
    (e.g. after a user rotates their OpenRouter key) leaks nothing beyond the
    cache's max size.
    """
    return _client_cache.get_or_create(api_key, lambda: OpenRouterClient(api_key))


def invalidate_openrouter_client(api_key: str) -> bool:
    """Close the cached client derived from an old API key."""
    return _client_cache.invalidate(api_key)


def close_openrouter_clients() -> None:
    """Close every cached OpenRouter client during application shutdown."""
    _client_cache.close_all()
