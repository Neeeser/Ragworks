"""Typed Anthropic Messages API client."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx
from anthropic import Anthropic

from app.cache import CachePolicy, CacheSnapshot, ResourceCache, ValueCache
from app.schemas.anthropic import AnthropicModel, MessagesResponse, MessagesStreamEvent

#: Anthropic requires `max_tokens` on every request and publishes no default,
#: so one has to be chosen. A model's published ceiling is the wrong choice: it
#: is a cap (64K to 128K), not a request size, and the SDK refuses a non-streaming
#: request whose `max_tokens` implies a response longer than ten minutes — so
#: defaulting to the ceiling makes every buffered turn fail before it is sent.
#: This is sized to finish a full tool-using turn instead.
DEFAULT_MAX_TOKENS = 8192

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
        # The explicit timeout is what governs a long turn: the SDK otherwise
        # substitutes its own ten-minute ceiling for non-streaming calls and
        # rejects any request whose `max_tokens` implies more. Our transport
        # policy (600s read, 5s connect) is the same one every other provider
        # client runs under, so a slow reasoning response behaves alike here.
        self._client = Anthropic(
            api_key=resolved,
            base_url=base_url or None,
            http_client=self._http,
            timeout=httpx.Timeout(
                INFERENCE_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS
            ),
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
        """Find one model in the (cached) catalog, resolving undated aliases.

        Anthropic accepts documented aliases (`claude-haiku-4-5`) that
        `GET /v1/models` does not publish — it lists the dated snapshot
        (`claude-haiku-4-5-20251001`). An exact-match-only lookup therefore
        refuses a model id that works, which reads to the user as the model
        being unavailable. The alias is resolved against the live listing
        rather than a shipped table, and only when exactly one published id
        extends it: two matches mean the alias is ambiguous, and guessing which
        snapshot the user meant is worse than reporting it unknown.
        """
        if not model_id:
            return None
        published = self.list_models().value
        for model in published:
            if model.id == model_id:
                return model
        prefix = f"{model_id}-"
        dated = [model for model in published if model.id.startswith(prefix)]
        return dated[0] if len(dated) == 1 else None

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
