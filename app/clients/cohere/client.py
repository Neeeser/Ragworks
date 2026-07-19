"""Typed HTTP client for Cohere's v1 catalog and v2 inference APIs."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any

import httpx

from app.cache import CachePolicy, CacheSnapshot, ResourceCache, ValueCache
from app.clients.cohere.schemas import (
    CohereChatResponse,
    CohereEmbedResponse,
    CohereModel,
    CohereModelsResponse,
    CohereRerankResponse,
    CohereStreamEvent,
)

_CATALOG_POLICY = CachePolicy(
    fresh_seconds=300,
    max_stale_seconds=900,
    failure_retry_seconds=30,
    max_entries=3,
)


class CohereClient:
    """Own an authenticated Cohere transport and its endpoint-filtered catalog."""

    def __init__(self, api_key: str) -> None:
        """Create a client for one Cohere API key."""
        resolved_key = api_key.strip()
        if not resolved_key:
            raise ValueError("Cohere API key must be provided.")
        self._http = httpx.Client(
            base_url="https://api.cohere.com",
            headers={"Authorization": f"Bearer {resolved_key}", "X-Client-Name": "Ragworks"},
            timeout=httpx.Timeout(60.0, connect=5.0),
        )
        self._models = ValueCache[str, list[CohereModel]](_CATALOG_POLICY)

    def _fetch_models(self, endpoint: str) -> list[CohereModel]:
        """Fetch all pages of models compatible with a Cohere endpoint."""
        models: list[CohereModel] = []
        page_token: str | None = None
        while True:
            params: dict[str, str | int] = {"endpoint": endpoint, "page_size": 1000}
            if page_token:
                params["page_token"] = page_token
            response = self._http.get("/v1/models", params=params)
            response.raise_for_status()
            page = CohereModelsResponse.model_validate(response.json())
            models.extend(page.models)
            if not page.next_page_token:
                return models
            page_token = page.next_page_token

    def list_models(
        self, endpoint: str, *, force_refresh: bool = False
    ) -> CacheSnapshot[list[CohereModel]]:
        """Return all endpoint-compatible models with cache freshness metadata."""
        return self._models.get(
            endpoint,
            lambda: self._fetch_models(endpoint),
            force_refresh=force_refresh,
        )

    def embed(
        self,
        texts: Iterable[str],
        *,
        model: str,
        input_type: str,
        output_dimension: int | None = None,
    ) -> CohereEmbedResponse:
        """Create float embeddings using Cohere's v2 retrieval API."""
        body: dict[str, Any] = {
            "texts": list(texts),
            "model": model,
            "input_type": input_type,
            "embedding_types": ["float"],
        }
        if output_dimension is not None:
            body["output_dimension"] = output_dimension
        response = self._http.post("/v2/embed", json=body)
        response.raise_for_status()
        return CohereEmbedResponse.model_validate(response.json())

    # The Cohere chat endpoint mirrors these knobs directly; grouping them would
    # only move the provider-independent request surface into another object.
    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _chat_body(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None,
        parameters: dict[str, Any] | None,
        stream: bool,
    ) -> dict[str, Any]:
        """Build the one request body shared by regular and SSE chat calls."""
        body: dict[str, Any] = {"messages": messages, "model": model, "stream": stream}
        if tools:
            body["tools"] = tools
        if parameters:
            body.update({key: value for key, value in parameters.items() if value is not None})
        return body

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        tools: list[dict[str, Any]] | None = None,
        parameters: dict[str, Any] | None = None,
    ) -> CohereChatResponse:
        """Request a non-streaming Cohere chat completion."""
        response = self._http.post(
            "/v2/chat", json=self._chat_body(messages, model, tools, parameters, stream=False)
        )
        response.raise_for_status()
        return CohereChatResponse.model_validate(response.json())

    def chat_stream(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        tools: list[dict[str, Any]] | None = None,
        parameters: dict[str, Any] | None = None,
    ) -> Iterator[CohereStreamEvent]:
        """Yield Cohere's v2 server-sent chat events."""
        body = self._chat_body(messages, model, tools, parameters, stream=True)
        with self._http.stream("POST", "/v2/chat", json=body) as response:
            response.raise_for_status()
            event_name: str | None = None
            data_lines: list[str] = []
            for line in response.iter_lines():
                if line:
                    if line.startswith("event:"):
                        event_name = line.removeprefix("event:").strip()
                    elif line.startswith("data:"):
                        data_lines.append(line.removeprefix("data:").strip())
                    continue
                if data_lines and not self._is_done_sentinel(data_lines):
                    yield self._parse_stream_event(event_name, data_lines)
                event_name = None
                data_lines = []
            if data_lines and not self._is_done_sentinel(data_lines):
                yield self._parse_stream_event(event_name, data_lines)

    @staticmethod
    def _is_done_sentinel(data_lines: list[str]) -> bool:
        """True for Cohere's terminal ``data: [DONE]`` frame, which is not JSON."""
        return data_lines == ["[DONE]"]

    @staticmethod
    def _parse_stream_event(
        event_name: str | None, data_lines: list[str]
    ) -> CohereStreamEvent:
        """Validate one complete SSE data frame, retaining unknown provider fields."""
        try:
            payload = json.loads("\n".join(data_lines))
        except ValueError as exc:
            raise ValueError("Cohere returned a malformed chat stream event.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Cohere returned a non-object chat stream event.")
        if event_name and "type" not in payload:
            payload["type"] = event_name
        payload["raw"] = payload.copy()
        return CohereStreamEvent.model_validate(payload)

    def rerank(
        self, *, model: str, query: str, documents: list[str]
    ) -> CohereRerankResponse:
        """Request a complete Cohere ranking for all supplied documents."""
        response = self._http.post(
            "/v2/rerank",
            json={"model": model, "query": query, "documents": documents, "top_n": len(documents)},
        )
        response.raise_for_status()
        return CohereRerankResponse.model_validate(response.json())

    def close(self) -> None:
        """Release the catalog refresh workers and HTTP connection pool."""
        self._models.close()
        self._http.close()


_client_cache: ResourceCache[str, CohereClient] = ResourceCache(max_entries=64)


def get_cohere_client(api_key: str) -> CohereClient:
    """Return a bounded cached client for this Cohere connection secret."""
    resolved_key = api_key.strip()
    return _client_cache.get_or_create(resolved_key, lambda: CohereClient(resolved_key))


def invalidate_cohere_client(api_key: str) -> bool:
    """Close the cached client associated with a rotated Cohere secret."""
    return _client_cache.invalidate(api_key.strip())


def close_cohere_clients() -> None:
    """Close every Cohere client during application shutdown."""
    _client_cache.close_all()
