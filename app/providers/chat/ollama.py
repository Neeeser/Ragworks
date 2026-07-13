"""Ollama provider implementation.

Maps the normalized `ChatRequest` onto Ollama's `/api/chat` wire format and
normalizes responses back into the shared parsed shapes. Notable translations:

- OpenAI-shaped history messages become Ollama messages (`tool_calls`
  arguments decode from JSON strings to dicts; `tool` results carry
  `tool_name` resolved from the calling assistant message, since Ollama has
  no tool-call ids).
- `reasoning_options` maps to `think` — a plain boolean, only for models whose
  capabilities include `"thinking"` (effort granularity is OpenRouter-specific
  and not portable across Ollama model families).
- Sampler parameters map onto `options.*` (`max_tokens` -> `num_predict`).
- Tool calls in responses get synthesized uuid-based ids to satisfy the
  tool-loop contract.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any
from uuid import uuid4

from app.clients.ollama import OllamaClient
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.schemas.models import ModelInfo
from app.schemas.ollama import OllamaChatResponse, OllamaModelDescription

# Sampler parameters exposed to the UI for every Ollama chat model; the keys
# are OpenRouter-canonical (what `sanitize_parameter_overrides` matches) and
# map onto Ollama `options` names below.
OLLAMA_SAMPLER_PARAMETERS = [
    "temperature",
    "top_p",
    "top_k",
    "seed",
    "stop",
    "max_tokens",
    "frequency_penalty",
    "presence_penalty",
    "repetition_penalty",
]

_OPTION_KEY_MAP = {"max_tokens": "num_predict", "repetition_penalty": "repeat_penalty"}


def model_info_from_description(description: OllamaModelDescription) -> ModelInfo:
    """Build the shared `ModelInfo` shape from an Ollama model description."""
    supported = list(OLLAMA_SAMPLER_PARAMETERS)
    if "tools" in description.capabilities:
        supported.append("tools")
    if "thinking" in description.capabilities:
        supported.append("reasoning")
    detail_parts = [
        part
        for part in (description.parameter_size, description.quantization_level)
        if part
    ]
    return ModelInfo(
        id=description.name,
        name=description.name,
        description=" · ".join(detail_parts) or None,
        context_length=description.context_length,
        supported_parameters=supported,
    )


def _decode_arguments(raw: Any) -> dict[str, Any]:
    """Decode tool-call arguments from a JSON string or pass a dict through."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            decoded = json.loads(raw)
        except ValueError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _coerce_content(content: Any) -> str:
    """Flatten OpenAI-style content (string or text-part list) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "".join(parts)
    return "" if content is None else str(content)


def convert_messages_to_ollama(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI-shaped history messages into Ollama chat messages."""
    call_id_to_name: dict[str, str] = {}
    converted: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = _coerce_content(message.get("content"))
        if role == "assistant" and message.get("tool_calls"):
            calls: list[dict[str, Any]] = []
            for call in message.get("tool_calls") or []:
                function = call.get("function") or {}
                name = str(function.get("name") or "")
                call_id = call.get("id")
                if call_id and name:
                    call_id_to_name[str(call_id)] = name
                calls.append(
                    {
                        "function": {
                            "name": name,
                            "arguments": _decode_arguments(function.get("arguments")),
                        }
                    }
                )
            converted.append({"role": role, "content": content, "tool_calls": calls})
        elif role == "tool":
            tool_name = call_id_to_name.get(str(message.get("tool_call_id") or ""), "")
            entry: dict[str, Any] = {"role": "tool", "content": content}
            if tool_name:
                entry["tool_name"] = tool_name
            converted.append(entry)
        else:
            converted.append({"role": role, "content": content})
    return converted


class OllamaChatProvider:
    """Ollama-backed chat provider implementation."""

    name = "ollama"

    def __init__(self, client: OllamaClient) -> None:
        """Store the Ollama client."""
        self._client = client
        # Ollama streams *complete* tool calls (no argument deltas), but the
        # stream accumulator merges fragments by index — two chunks that each
        # carried "index 0" would concatenate into one corrupt call. A
        # monotonically increasing counter keeps every streamed call distinct.
        self._stream_call_index = 0

    def _description(self, model_id: str) -> OllamaModelDescription | None:
        """Find the (cached) description for a model id."""
        for description in self._client.describe_models():
            if description.name == model_id:
                return description
        return None

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return model metadata for the requested model id."""
        description = self._description(model_id)
        if description is None:
            return None
        return model_info_from_description(description)

    def _resolve_think(self, request: ChatRequest) -> bool | None:
        """Map normalized reasoning options onto Ollama's `think` flag."""
        description = self._description(request.model)
        if description is None or "thinking" not in description.capabilities:
            return None
        reasoning = (request.reasoning_options or {}).get("reasoning")
        if not isinstance(reasoning, dict):
            return True
        excluded = reasoning.get("exclude") is True or reasoning.get("enabled") is False
        return not excluded

    @staticmethod
    def _build_options(request: ChatRequest) -> dict[str, Any] | None:
        """Map sanitized parameter overrides onto Ollama `options`."""
        if not request.parameters:
            return None
        options = {
            _OPTION_KEY_MAP.get(key, key): value
            for key, value in request.parameters.items()
            if key in OLLAMA_SAMPLER_PARAMETERS
        }
        return options or None

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Send a non-streaming chat request."""
        response = self._client.chat(
            messages=convert_messages_to_ollama(request.messages),
            model=request.model,
            tools=request.tools,
            options=self._build_options(request),
            think=self._resolve_think(request),
        )
        return response.model_dump(exclude_none=True)

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Stream a chat completion request, dumping each typed chunk to a dict."""
        for chunk in self._client.chat_stream(
            messages=convert_messages_to_ollama(request.messages),
            model=request.model,
            tools=request.tools,
            options=self._build_options(request),
            think=self._resolve_think(request),
        ):
            yield chunk.model_dump(exclude_none=True)

    def _openai_tool_calls(
        self, response: OllamaChatResponse, *, with_index: bool
    ) -> list[dict[str, Any]] | None:
        """Convert response tool calls to the OpenAI shape with synthesized ids."""
        message = response.message
        if message is None or not message.tool_calls:
            return None
        calls: list[dict[str, Any]] = []
        for call in message.tool_calls:
            entry: dict[str, Any] = {
                "id": f"tool_call_{uuid4().hex}",
                "type": "function",
                "function": {
                    "name": call.function.name,
                    "arguments": json.dumps(call.function.arguments),
                },
            }
            if with_index:
                entry["index"] = self._stream_call_index
                self._stream_call_index += 1
            calls.append(entry)
        return calls

    @staticmethod
    def _usage(response: OllamaChatResponse) -> dict[str, Any]:
        """Normalize Ollama eval counters into the shared usage shape."""
        usage: dict[str, Any] = {}
        if response.prompt_eval_count is not None:
            usage["prompt_tokens"] = response.prompt_eval_count
        if response.eval_count is not None:
            usage["completion_tokens"] = response.eval_count
        if usage:
            usage["total_tokens"] = (response.prompt_eval_count or 0) + (
                response.eval_count or 0
            )
        return usage

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize the Ollama chat response into the common shape."""
        parsed = OllamaChatResponse.model_validate(response)
        message: dict[str, Any] = {"role": "assistant", "content": ""}
        if parsed.message is not None:
            message["content"] = parsed.message.content
            if parsed.message.thinking:
                message["reasoning"] = parsed.message.thinking
            tool_calls = self._openai_tool_calls(parsed, with_index=False)
            if tool_calls:
                message["tool_calls"] = tool_calls
        return ParsedChatResponse(
            message=message,
            usage=self._usage(parsed),
            provider=self.name,
            response_model=parsed.model,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming NDJSON chunk into a delta snapshot."""
        if not isinstance(chunk, dict):
            return None
        parsed = OllamaChatResponse.model_validate(chunk)
        message = parsed.message
        usage = self._usage(parsed)
        return ParsedStreamChunk(
            provider=self.name,
            response_model=parsed.model,
            finish_reason=parsed.done_reason if parsed.done else None,
            delta_content=message.content if message else None,
            tool_calls=self._openai_tool_calls(parsed, with_index=True),
            reasoning=message.thinking if message else None,
            usage=usage or None,
        )
