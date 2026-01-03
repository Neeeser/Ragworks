"""OpenRouter provider implementation."""

from __future__ import annotations

from typing import Iterable, Optional

from pydantic import ValidationError

from app.chat.providers.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.schemas.models import ModelInfo
from app.schemas.openrouter import OpenRouterChatResponse, OpenRouterStreamChunk
from app.services.openrouter import OpenRouterClient


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

    def get_model(self, model_id: str) -> Optional[ModelInfo]:
        """Return model metadata for the requested model id."""
        return self._client.get_model(model_id)

    def chat(self, request: ChatRequest) -> dict:
        """Send a non-streaming chat request."""
        return self._client.chat(
            messages=request.messages,
            tools=request.tools,
            model=request.model,
            parallel_tool_calls=True,
            extra_body=request.extra_body,
            parameters=request.parameters or None,
        )

    def chat_stream(self, request: ChatRequest) -> Iterable[dict]:
        """Stream a chat completion request."""
        return self._client.chat_stream(
            messages=request.messages,
            tools=request.tools,
            model=request.model,
            parallel_tool_calls=True,
            extra_body=request.extra_body,
            parameters=request.parameters or None,
        )

    def parse_chat_response(self, response: dict) -> ParsedChatResponse:
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

    def parse_stream_chunk(self, chunk: dict) -> Optional[ParsedStreamChunk]:
        """Normalize a streaming chunk payload into a delta snapshot."""
        if not isinstance(chunk, dict):
            return None
        parsed_chunk: Optional[OpenRouterStreamChunk]
        try:
            parsed_chunk = self._stream_chunk_model.model_validate(chunk)
        except ValidationError:
            parsed_chunk = None

        if parsed_chunk:
            provider = parsed_chunk.provider
            response_model = parsed_chunk.model
            choices = parsed_chunk.choices
            usage = (
                parsed_chunk.usage.model_dump(exclude_none=True)
                if parsed_chunk.usage
                else None
            )
        else:
            provider = chunk.get("provider")
            response_model = chunk.get("model")
            choices = chunk.get("choices") or []
            usage = chunk.get("usage") if chunk.get("usage") else None

        if not choices:
            return None

        choice = choices[0]
        if parsed_chunk:
            finish_reason = choice.finish_reason
            delta = choice.delta
            delta_content = delta.content if delta else None
            tool_call_updates = (
                [call.model_dump(exclude_none=True) for call in delta.tool_calls]
                if delta and delta.tool_calls
                else None
            )
            reasoning = delta.reasoning if delta else None
        else:
            finish_reason = choice.get("finish_reason")
            delta = choice.get("delta") or {}
            delta_content = delta.get("content")
            tool_call_updates = delta.get("tool_calls") if delta.get("tool_calls") else None
            reasoning = delta.get("reasoning")

        return ParsedStreamChunk(
            provider=provider,
            response_model=response_model,
            finish_reason=finish_reason,
            delta_content=delta_content,
            tool_calls=tool_call_updates,
            reasoning=reasoning,
            usage=usage,
        )
