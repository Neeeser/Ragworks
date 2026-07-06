"""OpenRouter client wrapper and helpers."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import quote

import httpx
from openai import OpenAI

from app.api.config import get_settings
from app.schemas.models import EndpointsListResponse, ModelInfo


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
        self._client = OpenAI(
            base_url=self.settings.openrouter_base_url,
            api_key=self.api_key,
            http_client=self._http,
        )
        self._model_cache: dict[str, Any] = {"ts": 0.0, "data": []}
        self._embedding_model_cache: dict[str, Any] = {
            "ts": 0.0,
            "data": [],
            "dimensions": {},
        }

    def _build_app_headers(self) -> Dict[str, str]:
        """Build static headers required by OpenRouter."""
        headers = {"X-Title": self.settings.openrouter_site_name or "TransparentRag"}
        if self.settings.openrouter_site_url:
            headers["HTTP-Referer"] = self.settings.openrouter_site_url
        return headers

    def _merge_extra_headers(self, extra_headers: Optional[Dict[str, str]]) -> Dict[str, str]:
        """Merge dynamic headers with the default app headers."""
        if extra_headers:
            merged = dict(self._app_headers)
            merged.update(extra_headers)
            return merged
        return dict(self._app_headers)

    def list_models(self, force_refresh: bool = False) -> List[ModelInfo]:
        """Return available models, caching for a short period."""
        now = time.time()
        if (
            not force_refresh
            and now - self._model_cache["ts"] < 300
            and self._model_cache["data"]
        ):
            return self._model_cache["data"]
        response = self._http.get("/models")
        response.raise_for_status()
        payload = response.json()
        models = [ModelInfo(**item) for item in payload.get("data", [])]
        self._model_cache = {"ts": now, "data": models}
        return models

    def list_embedding_models(self, force_refresh: bool = False) -> List[dict[str, Any]]:
        """Return available embedding models, caching for a short period."""
        now = time.time()
        if (
            not force_refresh
            and now - self._embedding_model_cache["ts"] < 300
            and self._embedding_model_cache["data"]
        ):
            return self._embedding_model_cache["data"]
        response = self._http.get("/embeddings/models")
        response.raise_for_status()
        payload = response.json()
        models = payload.get("data") or []
        if not isinstance(models, list):
            models = []
        enriched: list[dict[str, Any]] = []
        dimension_cache = self._embedding_model_cache.get("dimensions") or {}
        for model in models:
            if not isinstance(model, dict):
                continue
            model_id = model.get("id")
            if not model_id:
                enriched.append(model)
                continue
            dimension = dimension_cache.get(str(model_id))
            if dimension is None:
                try:
                    dimension = self.get_embedding_dimension(str(model_id))
                    dimension_cache[str(model_id)] = dimension
                except ValueError:
                    dimension = None
            enriched.append({**model, "dimension": dimension})
        self._embedding_model_cache = {
            "ts": now,
            "data": enriched,
            "dimensions": dimension_cache,
        }
        return enriched

    def get_embedding_dimension(self, model_id: str) -> int:
        """Return embedding dimension for the requested model."""
        if not model_id:
            raise ValueError("Embedding model id must be provided.")
        payload = self.embed(["dimension_probe"], model=model_id)
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            raise ValueError("OpenRouter embeddings response missing data array.")
        first = data[0]
        if not isinstance(first, dict):
            raise ValueError("OpenRouter embeddings response entry is invalid.")
        embedding = first.get("embedding")
        if not isinstance(embedding, Iterable) or isinstance(embedding, (str, bytes)):
            raise ValueError("OpenRouter embeddings response missing embedding values.")
        return len(list(embedding))

    def get_current_key(self) -> dict[str, Any]:
        """Return metadata for the currently authenticated API key."""
        response = self._http.get("/key")
        response.raise_for_status()
        return response.json()

    def get_model(self, model_id: str) -> Optional[ModelInfo]:
        """Find a model by id or canonical slug."""
        if not model_id:
            return None

        def _match(models: List[ModelInfo]) -> Optional[ModelInfo]:
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

        cached = self.list_models()
        match = _match(cached)
        if match:
            return match
        refreshed = self.list_models(force_refresh=True)
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
        model: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        dimensions: Optional[int] = None,
    ) -> dict[str, Any]:
        """Create embeddings for the provided texts."""
        headers = self._merge_extra_headers(extra_headers)
        kwargs: Dict[str, Any] = {
            "model": model or self.settings.default_embedding_model,
            "input": list(texts),
            "encoding_format": "float",
            "extra_headers": headers,
        }
        if dimensions is not None:
            kwargs["dimensions"] = dimensions
        embeddings = self._client.embeddings.create(**kwargs)
        return embeddings.model_dump()

    # pylint: disable=too-many-arguments,too-many-positional-arguments
    def chat(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Dict[str, Any]] = None,
        parallel_tool_calls: Optional[bool] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        extra_body: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Create a chat completion with optional tools and parameters."""
        kwargs: Dict[str, Any] = {
            "messages": messages,
            "model": model or self.settings.default_chat_model,
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
        response = self._client.chat.completions.create(**kwargs)
        return response.model_dump()

    # pylint: disable=too-many-arguments,too-many-positional-arguments
    def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Dict[str, Any]] = None,
        parallel_tool_calls: Optional[bool] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        extra_body: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ):
        """Yield streaming chat completion chunks."""
        kwargs: Dict[str, Any] = {
            "messages": messages,
            "model": model or self.settings.default_chat_model,
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
        kwargs["stream"] = True
        stream = self._client.chat.completions.create(**kwargs)
        for chunk in stream:
            yield chunk.model_dump()

    def close(self) -> None:
        """Close the HTTP transport, releasing its connection pool.

        The SDK shares `self._http` (see `__init__`), so closing either would
        suffice; both are closed defensively in case they ever diverge again.
        """
        self._client.close()
        self._http.close()


class _ClientCache:  # pylint: disable=too-few-public-methods
    # Owns the cache's lock and dict; one method (`get_or_create`) is the whole
    # contract, there's nothing else this class needs to expose.
    """Bounded LRU cache of `OpenRouterClient` instances that closes evictions.

    `functools.lru_cache` cannot be used here: it drops references on eviction
    without ever calling `close()`, leaking the evicted client's `httpx.Client`
    connection pool. This cache is a plain `OrderedDict` guarded by a lock, with
    the oldest entry closed and removed whenever an insert would exceed `max_size`.
    """

    def __init__(self, max_size: int) -> None:
        """Initialize an empty cache bounded to `max_size` entries."""
        self._max_size = max_size
        self._entries: "OrderedDict[str, OpenRouterClient]" = OrderedDict()
        self._lock = threading.Lock()

    def get_or_create(
        self,
        key: str,
        factory: Callable[[str], OpenRouterClient],
    ) -> OpenRouterClient:
        """Return the cached client for `key`, creating and caching one if absent."""
        with self._lock:
            existing = self._entries.get(key)
            if existing is not None:
                self._entries.move_to_end(key)
                return existing
            client = factory(key)
            self._entries[key] = client
            if len(self._entries) > self._max_size:
                _evicted_key, evicted_client = self._entries.popitem(last=False)
                evicted_client.close()
            return client


_client_cache = _ClientCache(max_size=64)


def get_openrouter_client(api_key: str) -> OpenRouterClient:
    """Return a cached OpenRouter client instance, closing clients it evicts.

    Cached by raw API key so a given user's requests reuse one HTTP connection
    pool; the cache is bounded and closes whatever it evicts, so a stale key
    (e.g. after a user rotates their OpenRouter key) leaks nothing beyond the
    cache's max size.
    """
    return _client_cache.get_or_create(api_key, OpenRouterClient)
