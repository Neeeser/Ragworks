"""OpenRouter's chat provider: the shared dialect plus OpenRouter's extras.

Request shaping and response parsing are `ChatCompletionsProvider`'s — the same
code OpenAI, vLLM, llama.cpp, and LM Studio run through. What OpenRouter adds
is an `extra_body` block: its reasoning options, its provider-routing
preferences, and the `usage: {include: true}` flag without which OpenRouter
omits token accounting entirely.
"""

from __future__ import annotations

from typing import Any

from app.clients.openrouter import OpenRouterClient
from app.providers.chat.base import ChatRequest
from app.providers.chat.dialects import ChatCompletionsProvider


def build_openrouter_body(
    reasoning_options: dict[str, Any] | None,
    provider_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the OpenRouter extra_body payload for chat requests."""
    body: dict[str, Any] = dict(reasoning_options) if reasoning_options else {}
    usage_config = body.get("usage")
    if isinstance(usage_config, dict):
        merged_usage = dict(usage_config)
        merged_usage["include"] = True
        body["usage"] = merged_usage
    else:
        body["usage"] = {"include": True}
    if provider_options:
        body["provider"] = provider_options
    return body


class OpenRouterProvider(ChatCompletionsProvider):
    """Chat Completions over OpenRouter, with its routing block attached."""

    def __init__(self, client: OpenRouterClient) -> None:
        """Bind the dialect to OpenRouter's transport and per-model catalog."""
        super().__init__(client.compat, name="openrouter", model_resolver=client.get_model)

    def build_extra_body(self, request: ChatRequest) -> dict[str, Any] | None:
        """Attach OpenRouter's reasoning, routing, and usage-accounting block."""
        return build_openrouter_body(request.reasoning_options, request.provider_preferences)
