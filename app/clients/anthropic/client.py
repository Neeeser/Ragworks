"""Typed Anthropic Messages API client."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx
from anthropic import Anthropic

from app.cache import CachePolicy, CacheSnapshot, ResourceCache, ValueCache
from app.schemas.anthropic import AnthropicModel, MessagesResponse, MessagesStreamEvent

#: Anthropic requires `max_tokens` on every request and publishes no default.
#: A model's own ceiling is used when the catalog is reachable; this is the
#: floor for the window where it is not, chosen to fit a full tool-using turn
#: rather than truncating one mid-sentence.
FALLBACK_MAX_TOKENS = 8192

INFERENCE_TIMEOUT_SECONDS = 600.0
CONNECT_TIMEOUT_SECONDS = 5.0

_CATALOG_POLICY = CachePolicy(
    fresh_seconds=900,
    max_stale_seconds=3600,
    failure_retry_seconds=30,
    max_entries=1,
)


@dataclass(frozen=True)
class MessagesCall:
    """One Messages API invocation."""

    messages: list[dict[str, Any]]
    model: str
    max_tokens: int
    system: str | None = None
    tools: list[dict[str, Any]] | None = None
    thinking: dict[str, Any] | None = None
    parameters: dict[str, Any] | None = None


class AnthropicClient:
    """Wrapper around the official Anthropic SDK."""

    def __init__(self, api_key: str, base_url: str | None = None) -> None:
        """Initialize the SDK client for one credential."""
        resolved = (api_key or "").strip()
        if not resolved:
            raise ValueError("Anthropic API key must be provided.")
        self.api_key = resolved
        self._http = httpx.Client(
            timeout=httpx.Timeout(
                INFERENCE_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS
            )
        )
        self._client = Anthropic(
            api_key=resolved,
            base_url=base_url or None,
            http_client=self._http,
            max_retries=1,
        )
        self._catalog: ValueCache[str, list[AnthropicModel]] = ValueCache(_CATALOG_POLICY)

    def _build_kwargs(self, call: MessagesCall, *, stream: bool) -> dict[str, Any]:
        """Assemble the SDK kwargs shared by the streaming and buffered paths."""
        kwargs: dict[str, Any] = {
            "model": call.model,
            "max_tokens": call.max_tokens,
            "messages": call.messages,
        }
        if call.system:
            kwargs["system"] = call.system
        if call.tools:
            kwargs["tools"] = call.tools
        if call.thinking:
            kwargs["thinking"] = call.thinking
        if call.parameters:
            kwargs.update(
                {key: value for key, value in call.parameters.items() if value is not None}
            )
        if stream:
            kwargs["stream"] = True
        return kwargs

    def create_message(self, call: MessagesCall) -> MessagesResponse:
        """Request a buffered message."""
        response = self._client.messages.create(**self._build_kwargs(call, stream=False))
        return MessagesResponse.model_validate(response.model_dump())

    def stream_message(self, call: MessagesCall) -> Iterator[MessagesStreamEvent]:
        """Yield raw Messages stream events."""
        stream = self._client.messages.create(**self._build_kwargs(call, stream=True))
        for event in stream:
            yield MessagesStreamEvent.model_validate(event.model_dump())

    def _fetch_models(self) -> list[AnthropicModel]:
        """Fetch the published model catalog (auto-paginating)."""
        return [
            AnthropicModel.model_validate(model.model_dump())
            for model in self._client.models.list()
        ]

    def list_models(
        self, force_refresh: bool = False
    ) -> CacheSnapshot[list[AnthropicModel]]:
        """Return the model catalog, caching it for a short period."""
        return self._catalog.get(
            "models", self._fetch_models, force_refresh=force_refresh
        )

    def get_model(self, model_id: str) -> AnthropicModel | None:
        """Find one model in the (cached) catalog."""
        for model in self.list_models().value:
            if model.id == model_id:
                return model
        return None

    def close(self) -> None:
        """Close the SDK and the HTTP pool it shares."""
        self._catalog.close()
        self._client.close()
        self._http.close()


_client_cache: ResourceCache[tuple[str, str | None], AnthropicClient] = ResourceCache(
    max_entries=32, key_material=repr
)


def get_anthropic_client(api_key: str, base_url: str | None = None) -> AnthropicClient:
    """Return the cached Anthropic client for one credential."""
    return _client_cache.get_or_create(
        (api_key, base_url), lambda: AnthropicClient(api_key, base_url)
    )


def invalidate_anthropic_client(api_key: str, base_url: str | None = None) -> bool:
    """Close the cached client derived from an old credential."""
    return _client_cache.invalidate((api_key, base_url))


def close_anthropic_clients() -> None:
    """Close every cached Anthropic client during application shutdown."""
    _client_cache.close_all()
