"""Typed OpenRouter HTTP + OpenAI-compatible SDK client."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Any
from urllib.parse import quote

import httpx
from openai import OpenAI

from app.cache import CacheSnapshot, ResourceCache
from app.clients.openrouter.catalog import ModelCatalog
from app.core.config import get_settings
from app.schemas.models import EmbeddingModelInfo, EndpointsListResponse, ModelInfo
from app.schemas.openrouter import (
    OpenRouterChatResponse,
    OpenRouterEmbeddingsResponse,
    OpenRouterKeyInfo,
    OpenRouterStreamChunk,
)


class OpenRouterClient:
    """Wrapper around the OpenRouter HTTP + OpenAI-compatible SDK."""

    def __init__(self, api_key: str) -> None:
        """Initialize HTTP and SDK clients for OpenRouter."""
        resolved_key = (api_key or "").strip()
        if not resolved_key:
            raise ValueError("OpenRouter API key must be provided.")
        self.api_key = resolved_key
        self.settings = get_settings()
        self._app_headers = self._build_app_headers()
        default_headers = {"Authorization": f"Bearer {self.api_key}"}
        default_headers.update(self._app_headers)

        self._http = httpx.Client(
            base_url=self.settings.openrouter_base_url,
            headers=default_headers,
            timeout=60.0,
        )
        # Share the httpx client with the SDK: without `http_client=` the OpenAI
        # SDK builds its own internal httpx.Client, which `close()` would miss —
        # leaking the pool that carries the main chat/chat_stream traffic.
        # The explicit timeout preserves the SDK default (600s, 5s connect) —
        # without it the SDK would inherit `_http`'s flat 60s REST timeout, and
        # long reasoning-model chat responses could time out.
        self._client = OpenAI(
            base_url=self.settings.openrouter_base_url,
            api_key=self.api_key,
            http_client=self._http,
            timeout=httpx.Timeout(600.0, connect=5.0),
        )
        self._catalog = ModelCatalog(
            fetch_models=self._fetch_models,
            fetch_embedding_models=self._fetch_embedding_models,
            probe_embedding=self._probe_embedding_dimension,
        )

    def _build_app_headers(self) -> dict[str, str]:
        """Build static headers required by OpenRouter."""
        headers = {"X-Title": self.settings.openrouter_site_name or "Ragworks"}
        if self.settings.openrouter_site_url:
            headers["HTTP-Referer"] = self.settings.openrouter_site_url
        return headers

    def _merge_extra_headers(self, extra_headers: dict[str, str] | None) -> dict[str, str]:
        """Merge dynamic headers with the default app headers."""
        if extra_headers:
            merged = dict(self._app_headers)
            merged.update(extra_headers)
            return merged
        return dict(self._app_headers)

    def _fetch_models(self) -> list[ModelInfo]:
        """Fetch the full model list from OpenRouter (no caching)."""
        response = self._http.get("/models")
        response.raise_for_status()
        payload = response.json()
        return [ModelInfo(**item) for item in payload.get("data", [])]

    def _fetch_embedding_models(self) -> list[EmbeddingModelInfo]:
        """Fetch the embedding model list from OpenRouter (no caching, no dimensions)."""
        response = self._http.get("/embeddings/models")
        response.raise_for_status()
        payload = response.json()
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
                top_provider.get("context_length")
                if isinstance(top_provider, dict)
                else None
            )
            models.append(
                EmbeddingModelInfo(
                    id=str(model_id),
                    name=str(item.get("name") or model_id),
                    description=item.get("description"),
                    context_length=item.get("context_length"),
                    max_input_tokens=max_input_tokens,
                    pricing=item.get("pricing"),
                )
            )
        return models

    def _probe_embedding_dimension(self, model_id: str) -> OpenRouterEmbeddingsResponse:
        """Issue a single-input embeddings call used to measure vector length."""
        return self.embed(["dimension_probe"], model=model_id)

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

    def get_embedding_dimension(self, model_id: str) -> int:
        """Return embedding dimension for the requested model."""
        return self._catalog.get_embedding_dimension(model_id)

    def get_current_key(self) -> OpenRouterKeyInfo:
        """Return metadata for the currently authenticated API key."""
        response = self._http.get("/key")
        response.raise_for_status()
        return OpenRouterKeyInfo.model_validate(response.json())

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

        cached = self.list_models().value
        match = _match(cached)
        if match:
            return match
        refreshed = self.list_models(force_refresh=True).value
        return _match(refreshed)

    def list_model_endpoints(self, author: str, slug: str) -> EndpointsListResponse:
        """Return endpoint listings for a given model author/slug."""
        author_segment = quote(author, safe="")
        slug_segment = quote(slug, safe="")
        response = self._http.get(f"/models/{author_segment}/{slug_segment}/endpoints")
        response.raise_for_status()
        payload = response.json()
        return EndpointsListResponse(**payload)

    def embed(
        self,
        texts: Iterable[str],
        model: str,
        extra_headers: dict[str, str] | None = None,
        dimensions: int | None = None,
    ) -> OpenRouterEmbeddingsResponse:
        """Create embeddings for the provided texts."""
        headers = self._merge_extra_headers(extra_headers)
        kwargs: dict[str, Any] = {
            "model": model,
            "input": list(texts),
            "encoding_format": "float",
            "extra_headers": headers,
        }
        if dimensions is not None:
            kwargs["dimensions"] = dimensions
        embeddings = self._client.embeddings.create(**kwargs)
        return OpenRouterEmbeddingsResponse.model_validate(embeddings.model_dump())

    # OpenRouter's chat-completion surface has ~8 independent optional knobs
    # (tools, tool_choice, parallel_tool_calls, extra_headers/body, parameters,
    # stream); grouping them into an object would just relocate the same list.
    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _build_chat_kwargs(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None,
        tool_choice: dict[str, Any] | None,
        parallel_tool_calls: bool | None,
        extra_headers: dict[str, str] | None,
        extra_body: dict[str, Any] | None,
        parameters: dict[str, Any] | None,
        stream: bool,
    ) -> dict[str, Any]:
        """Assemble the SDK kwargs shared by `chat` and `chat_stream`."""
        kwargs: dict[str, Any] = {
            "messages": messages,
            "model": model,
        }
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        if parallel_tool_calls is not None:
            kwargs["parallel_tool_calls"] = parallel_tool_calls
        kwargs["extra_headers"] = self._merge_extra_headers(extra_headers)
        if extra_body:
            kwargs["extra_body"] = extra_body
        if parameters:
            for key, value in parameters.items():
                if value is not None:
                    kwargs[key] = value
        if stream:
            kwargs["stream"] = True
        return kwargs

    # Mirrors the OpenRouter SDK's chat.completions.create surface one-for-one;
    # see the comment on `_build_chat_kwargs` for why these aren't grouped.
    # pylint: disable=too-many-arguments,too-many-positional-arguments
    def chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: dict[str, Any] | None = None,
        parallel_tool_calls: bool | None = None,
        extra_headers: dict[str, str] | None = None,
        extra_body: dict[str, Any] | None = None,
        parameters: dict[str, Any] | None = None,
    ) -> OpenRouterChatResponse:
        """Create a chat completion with optional tools and parameters."""
        kwargs = self._build_chat_kwargs(
            messages,
            model,
            tools,
            tool_choice,
            parallel_tool_calls,
            extra_headers,
            extra_body,
            parameters,
            stream=False,
        )
        response = self._client.chat.completions.create(**kwargs)
        return OpenRouterChatResponse.model_validate(response.model_dump())

    # Streaming twin of `chat`; same surface, see `_build_chat_kwargs` for why.
    # pylint: disable=too-many-arguments,too-many-positional-arguments
    def chat_stream(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: dict[str, Any] | None = None,
        parallel_tool_calls: bool | None = None,
        extra_headers: dict[str, str] | None = None,
        extra_body: dict[str, Any] | None = None,
        parameters: dict[str, Any] | None = None,
    ) -> Iterator[OpenRouterStreamChunk]:
        """Yield streaming chat completion chunks."""
        kwargs = self._build_chat_kwargs(
            messages,
            model,
            tools,
            tool_choice,
            parallel_tool_calls,
            extra_headers,
            extra_body,
            parameters,
            stream=True,
        )
        stream = self._client.chat.completions.create(**kwargs)
        for chunk in stream:
            yield OpenRouterStreamChunk.model_validate(chunk.model_dump())

    def close(self) -> None:
        """Close the HTTP transport, releasing its connection pool.

        The SDK shares `self._http` (see `__init__`), so closing either would
        suffice; both are closed defensively in case they ever diverge again.
        """
        self._catalog.close()
        self._client.close()
        self._http.close()


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
