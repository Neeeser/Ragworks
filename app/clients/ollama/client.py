"""Typed HTTP client for the official Ollama API.

Talks to a user-supplied Ollama server (`base_url`), optionally sending a
bearer token for reverse-proxied deployments. Chat streaming is NDJSON — one
`OllamaChatResponse`-shaped JSON object per line. In-band error payloads
(`{"error": ...}`) raise `OllamaApiError`, which service boundaries classify
as an external provider fault.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any

import httpx

from app.cache import CacheSnapshot, ResourceCache
from app.clients.ollama.catalog import OllamaCatalog
from app.clients.ollama.errors import OllamaApiError
from app.schemas.ollama import (
    OllamaChatResponse,
    OllamaEmbedResponse,
    OllamaModelDescription,
    OllamaShowResponse,
    OllamaTagsResponse,
    OllamaVersionResponse,
)


def _raise_for_status(response: httpx.Response) -> None:
    """Raise `OllamaApiError` carrying the server's error message on non-2xx."""
    if response.is_success:
        return
    message = f"Ollama request failed with status {response.status_code}."
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict) and payload.get("error"):
        message = str(payload["error"])
    raise OllamaApiError(message, status_code=response.status_code)


class OllamaClient:
    """Wrapper around one Ollama server's HTTP API."""

    def __init__(self, base_url: str, api_key: str | None = None) -> None:
        """Initialize the HTTP transport for the given server."""
        resolved_url = (base_url or "").strip().rstrip("/")
        if not resolved_url:
            raise ValueError("Ollama base URL must be provided.")
        headers: dict[str, str] = {}
        resolved_key = (api_key or "").strip()
        if resolved_key:
            headers["Authorization"] = f"Bearer {resolved_key}"
        # Local models can be slow to load and generate; mirror the generous
        # read timeout the OpenRouter SDK uses while keeping connects fast.
        self._http = httpx.Client(
            base_url=resolved_url,
            headers=headers,
            timeout=httpx.Timeout(600.0, connect=5.0),
        )
        self._catalog = OllamaCatalog(fetch_tags=self.list_tags, fetch_show=self.show)

    def version(self) -> str:
        """Return the server version (cheap connectivity/credential probe)."""
        response = self._http.get("/api/version")
        _raise_for_status(response)
        return OllamaVersionResponse.model_validate(response.json()).version

    def list_tags(self) -> OllamaTagsResponse:
        """Fetch the locally available models (no caching)."""
        response = self._http.get("/api/tags")
        _raise_for_status(response)
        return OllamaTagsResponse.model_validate(response.json())

    def show(self, model: str) -> OllamaShowResponse:
        """Fetch detailed model information (capabilities, architecture info)."""
        response = self._http.post("/api/show", json={"model": model})
        _raise_for_status(response)
        return OllamaShowResponse.model_validate(response.json())

    def describe_models(
        self, force_refresh: bool = False
    ) -> CacheSnapshot[list[OllamaModelDescription]]:
        """Return capability-classified model descriptions, TTL-cached."""
        return self._catalog.describe_models(force_refresh=force_refresh)

    def embed(
        self,
        texts: Iterable[str],
        model: str,
        dimensions: int | None = None,
    ) -> OllamaEmbedResponse:
        """Create embeddings for the provided texts via `/api/embed`."""
        body: dict[str, Any] = {"model": model, "input": list(texts)}
        if dimensions is not None:
            body["dimensions"] = dimensions
        response = self._http.post("/api/embed", json=body)
        _raise_for_status(response)
        return OllamaEmbedResponse.model_validate(response.json())

    # Mirrors Ollama's /api/chat body surface one-for-one (messages, model,
    # tools, options, think, stream); grouping them would just relocate the list.
    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _build_chat_body(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None,
        options: dict[str, Any] | None,
        think: bool | str | None,
        stream: bool,
    ) -> dict[str, Any]:
        """Assemble the `/api/chat` request body shared by both chat modes."""
        body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream}
        if tools:
            body["tools"] = tools
        if options:
            body["options"] = options
        if think is not None:
            body["think"] = think
        return body

    def chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        options: dict[str, Any] | None = None,
        think: bool | str | None = None,
    ) -> OllamaChatResponse:
        """Request a non-streaming chat completion."""
        body = self._build_chat_body(messages, model, tools, options, think, stream=False)
        response = self._http.post("/api/chat", json=body)
        _raise_for_status(response)
        parsed = OllamaChatResponse.model_validate(response.json())
        if parsed.error:
            raise OllamaApiError(parsed.error)
        return parsed

    def chat_stream(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        options: dict[str, Any] | None = None,
        think: bool | str | None = None,
    ) -> Iterator[OllamaChatResponse]:
        """Yield streaming chat chunks parsed from NDJSON lines."""
        body = self._build_chat_body(messages, model, tools, options, think, stream=True)
        with self._http.stream("POST", "/api/chat", json=body) as response:
            if not response.is_success:
                response.read()
                _raise_for_status(response)
            for line in response.iter_lines():
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except ValueError as exc:
                    raise OllamaApiError(
                        "The Ollama server sent a malformed stream line."
                    ) from exc
                chunk = OllamaChatResponse.model_validate(payload)
                if chunk.error:
                    raise OllamaApiError(chunk.error)
                yield chunk

    def close(self) -> None:
        """Close the HTTP transport, releasing its connection pool."""
        self._catalog.close()
        self._http.close()


OllamaClientKey = tuple[str, str]


def _client_key(base_url: str, api_key: str | None) -> OllamaClientKey:
    return (base_url.strip().rstrip("/"), (api_key or "").strip())


_client_cache: ResourceCache[OllamaClientKey, OllamaClient] = ResourceCache(
    max_entries=64, key_material=lambda key: "\n".join(key)
)


def get_ollama_client(base_url: str, api_key: str | None = None) -> OllamaClient:
    """Return a cached Ollama client for the given server, closing evictions.

    Keyed by URL + key so rotating either yields a fresh client while the
    bounded cache closes whatever it evicts.
    """
    cache_key = _client_key(base_url, api_key)
    return _client_cache.get_or_create(cache_key, lambda: OllamaClient(base_url, api_key))


def invalidate_ollama_client(base_url: str, api_key: str | None = None) -> bool:
    """Close the cached client derived from an old server configuration."""
    return _client_cache.invalidate(_client_key(base_url, api_key))


def close_ollama_clients() -> None:
    """Close every cached Ollama client during application shutdown."""
    _client_cache.close_all()
