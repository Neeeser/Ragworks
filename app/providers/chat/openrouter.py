"""OpenRouter provider implementation."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from pydantic import ValidationError

from app.clients.openrouter import OpenRouterClient
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.schemas.models import ModelInfo
from app.schemas.openrouter import OpenRouterChatResponse, OpenRouterStreamChunk


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


class OpenRouterProvider:
    """OpenRouter-backed chat provider implementation."""

    name = "openrouter"

    def __init__(
        self,
        client: OpenRouterClient,
        stream_chunk_model: type[OpenRouterStreamChunk] = OpenRouterStreamChunk,
    ) -> None:
        """Store the OpenRouter client and model parser."""
        self._client = client
        self._stream_chunk_model = stream_chunk_model

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return model metadata for the requested model id."""
        return self._client.get_model(model_id)

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Send a non-streaming chat request.

        `OpenRouterClient.chat` returns a validated `OpenRouterChatResponse`;
        this dumps it back to a dict at the provider boundary so the
        `ChatProvider` protocol (still dict-based pending Task 4.1's chat
        internals rewrite) doesn't change here. `exclude_none=True` keeps the
        dumped shape close to OpenRouter's actual (sparse) payload rather than
        materializing every optional schema field as an explicit `None`.
        """
        response = self._client.chat(
            messages=request.messages,
            tools=request.tools,
            model=request.model,
            parallel_tool_calls=True,
            extra_body=self._build_extra_body(request),
            parameters=request.parameters or None,
        )
        return response.model_dump(exclude_none=True)

    @staticmethod
    def _build_extra_body(request: ChatRequest) -> dict[str, Any]:
        """Map the normalized request onto OpenRouter's `extra_body` shape."""
        return build_openrouter_body(request.reasoning_options, request.provider_preferences)

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Stream a chat completion request, dumping each typed chunk to a dict."""
        for chunk in self._client.chat_stream(
            messages=request.messages,
            tools=request.tools,
            model=request.model,
            parallel_tool_calls=True,
            extra_body=self._build_extra_body(request),
            parameters=request.parameters or None,
        ):
            yield chunk.model_dump(exclude_none=True)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize the OpenRouter chat response into a common shape."""
        parsed_response = OpenRouterChatResponse.model_validate(response)
        choice = parsed_response.choices[0]
        message = choice.message.model_dump(exclude_none=True) if choice.message else {}
        usage = (
            parsed_response.usage.model_dump(exclude_none=True)
            if parsed_response.usage
            else {}
        )
        provider = parsed_response.provider or self.name
        response_model = parsed_response.model
        return ParsedChatResponse(
            message=message,
            usage=usage,
            provider=provider,
            response_model=response_model,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming chunk payload into a delta snapshot.

        A chunk that validates as `OpenRouterStreamChunk` is read through the
        typed model; one that fails validation falls back to lenient dict
        access. The two paths are kept separate so neither leaks the other's
        shape.
        """
        if not isinstance(chunk, dict):
            return None
        try:
            parsed_chunk = self._stream_chunk_model.model_validate(chunk)
        except ValidationError:
            return self._parse_raw_stream_chunk(chunk)
        return self._parse_typed_stream_chunk(parsed_chunk)

    @staticmethod
    def _parse_typed_stream_chunk(parsed_chunk: OpenRouterStreamChunk) -> ParsedStreamChunk | None:
        """Extract a delta snapshot from a validated stream chunk."""
        if not parsed_chunk.choices:
            return None
        choice = parsed_chunk.choices[0]
        delta = choice.delta
        tool_call_updates = (
            [call.model_dump(exclude_none=True) for call in delta.tool_calls]
            if delta and delta.tool_calls
            else None
        )
        usage = parsed_chunk.usage.model_dump(exclude_none=True) if parsed_chunk.usage else None
        return ParsedStreamChunk(
            provider=parsed_chunk.provider,
            response_model=parsed_chunk.model,
            finish_reason=choice.finish_reason,
            delta_content=delta.content if delta else None,
            tool_calls=tool_call_updates,
            reasoning=delta.reasoning if delta else None,
            usage=usage,
        )

    @staticmethod
    def _parse_raw_stream_chunk(chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Extract a delta snapshot from a chunk that failed typed validation."""
        choices = chunk.get("choices") or []
        if not choices:
            return None
        choice = choices[0]
        delta = choice.get("delta") or {}
        tool_call_updates = delta.get("tool_calls") if delta.get("tool_calls") else None
        return ParsedStreamChunk(
            provider=chunk.get("provider"),
            response_model=chunk.get("model"),
            finish_reason=choice.get("finish_reason"),
            delta_content=delta.get("content"),
            tool_calls=tool_call_updates,
            reasoning=delta.get("reasoning"),
            usage=chunk.get("usage") if chunk.get("usage") else None,
        )
