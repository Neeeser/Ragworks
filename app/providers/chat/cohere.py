"""Cohere v2 chat adapter and response normalization."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.clients.cohere import CohereClient
from app.clients.cohere.schemas import CohereChatResponse, CohereMessage, CohereStreamEvent
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.schemas.models import ModelInfo

_PARAMETER_MAP = {
    "top_p": "p",
    "top_k": "k",
    "stop": "stop_sequences",
}


def _text_content(content: Any) -> str:
    """Flatten Ragworks/OpenAI message content to Cohere's text form."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return "" if content is None else str(content)


def convert_messages_to_cohere(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Translate normalized history into Cohere's v2 message representation."""
    converted: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        if role == "tool":
            converted.append(
                {
                    "role": "tool",
                    "tool_call_id": message.get("tool_call_id"),
                    "content": [
                        {
                            "type": "document",
                            "document": {"data": _text_content(message.get("content"))},
                        }
                    ],
                }
            )
            continue
        entry: dict[str, Any] = {"role": role, "content": _text_content(message.get("content"))}
        if role == "assistant" and message.get("tool_calls"):
            entry["tool_calls"] = message["tool_calls"]
        converted.append(entry)
    return converted


def _cohere_parameters(parameters: dict[str, Any] | None) -> dict[str, Any] | None:
    """Rename normalized sampler parameters to Cohere's v2 names."""
    if not parameters:
        return None
    mapped = {
        _PARAMETER_MAP.get(key, key): value
        for key, value in parameters.items()
        if value is not None
    }
    return mapped or None


def _usage_payload(message_usage: Any) -> dict[str, int]:
    """Normalize Cohere usage into the shared prompt/completion shape."""
    usage = message_usage.tokens or message_usage.billed_units if message_usage else None
    if usage is None:
        return {}
    prompt = usage.input_tokens or 0
    completion = usage.output_tokens or 0
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
    }


def _message_content(message: CohereMessage) -> str:
    """Join textual Cohere content blocks in their response order."""
    if isinstance(message.content, list):
        return "".join(block.text or "" for block in message.content)
    return message.content.text or "" if message.content else ""


def _tool_calls(message: CohereMessage, index: int | None = None) -> list[dict[str, Any]] | None:
    """Translate Cohere tool calls to the stream accumulator's canonical format."""
    calls = message.tool_calls
    if calls is None:
        return None
    sequence = calls if isinstance(calls, list) else [calls]
    rendered: list[dict[str, Any]] = []
    for call in sequence:
        item: dict[str, Any] = {
            "id": call.id,
            "type": call.type or "function",
            "function": {
                "name": call.function.name,
                "arguments": call.function.arguments or "",
            },
        }
        if index is not None:
            item["index"] = index
        rendered.append(item)
    return rendered


class CohereChatProvider:
    """Cohere-backed implementation of Ragworks' normalized chat interface."""

    name = "cohere"

    def __init__(self, client: CohereClient) -> None:
        """Store the Cohere client for this provider connection."""
        self._client = client

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Look up chat model metadata from Cohere's endpoint-filtered catalog."""
        normalized = model_id.casefold()
        for model in self._client.list_models("chat").value:
            if model.name.casefold() == normalized:
                return ModelInfo(
                    id=model.name,
                    name=model.name,
                    description=model.description,
                    context_length=model.context_length,
                    supported_parameters=[
                        "temperature",
                        "top_p",
                        "top_k",
                        "max_tokens",
                        "frequency_penalty",
                        "presence_penalty",
                        "seed",
                        "stop",
                        "tools",
                    ],
                )
        return None

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Send a non-streaming Cohere chat completion."""
        response = self._client.chat(
            convert_messages_to_cohere(request.messages),
            model=request.model,
            tools=request.tools,
            parameters=_cohere_parameters(request.parameters),
        )
        return CohereChatResponse.model_validate(response).model_dump(exclude_none=True)

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Yield Cohere SSE events as sparse dictionaries."""
        for event in self._client.chat_stream(
            convert_messages_to_cohere(request.messages),
            model=request.model,
            tools=request.tools,
            parameters=_cohere_parameters(request.parameters),
        ):
            yield event.model_dump(exclude_none=True)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize Cohere's content blocks, tool calls, and usage envelope."""
        parsed = CohereChatResponse.model_validate(response)
        message: dict[str, Any] = {"role": parsed.message.role or "assistant", "content": _message_content(parsed.message)}
        calls = _tool_calls(parsed.message)
        if calls:
            message["tool_calls"] = calls
        if parsed.message.tool_plan:
            message["reasoning"] = parsed.message.tool_plan
        return ParsedChatResponse(
            message=message,
            usage=_usage_payload(parsed.usage),
            provider=self.name,
            response_model=parsed.model,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize content and tool-call SSE events into shared stream deltas."""
        event = CohereStreamEvent.model_validate(chunk)
        message = event.delta.message
        tool_calls = _tool_calls(message, event.index) if message else None
        delta_content = _message_content(message) if message else None
        reasoning = message.tool_plan if message else None
        if event.type == "tool-call-delta" and tool_calls:
            for call in tool_calls:
                call.pop("id", None)
                call.pop("type", None)
                name = call["function"].get("name")
                if name is None:
                    call["function"].pop("name", None)
        if event.type not in {"content-delta", "tool-plan-delta", "tool-call-start", "tool-call-delta", "message-end"}:
            return None
        return ParsedStreamChunk(
            provider=self.name,
            response_model=event.model,
            finish_reason=event.delta.finish_reason,
            delta_content=delta_content,
            tool_calls=tool_calls,
            reasoning=reasoning,
            usage=_usage_payload(event.delta.usage) or None,
        )
