"""Streaming chat completion helpers for OpenRouter-style providers."""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from pydantic import BaseModel

from app.chat.providers.base import ChatProvider, ChatRequest, ParsedStreamChunk
from app.chat.reasoning import extend_reasoning_segments, normalize_reasoning_segments
from app.chat.tool_calls import accumulate_stream_tool_calls, coerce_stream_text


@dataclass
class StreamState:
    """Mutable state for streaming response assembly."""

    provider: str
    content_parts: list[str] = field(default_factory=list)
    reasoning_segments: list[dict[str, Any]] = field(default_factory=list)
    tool_call_fragments: dict[int, dict[str, Any]] = field(default_factory=dict)
    latest_usage: dict[str, Any] = field(default_factory=dict)
    finish_reason: str | None = None
    response_model: str | None = None


class StreamOutcome(BaseModel):
    """Result of one streaming provider turn — replaces the old 5-tuple.

    `message` and `usage` stay free-form dicts rather than typed models:
    provider payloads carry extra, provider-specific keys that aren't a
    stable key set (`reasoning` vs `reasoning_content`; usage's
    `cost_details`/`completion_tokens_details`) and are read/passed through
    verbatim elsewhere (`ChatService._resolve_tool_calls`,
    `ChatCompletionResponse.usage`). Unlike the tuple it replaces, every
    field — including `finish_reason` — is preserved structurally; whether
    `ChatService` acts on `finish_reason` yet is a separate concern.
    """

    message: dict[str, Any]
    usage: dict[str, Any]
    provider: str
    finish_reason: str | None
    response_model: str | None


def stream_model_completion(
    *,
    provider: ChatProvider,
    request: ChatRequest,
) -> Generator[dict[str, Any], None, StreamOutcome]:
    """Stream a chat completion and yield token/tool events."""
    stream = provider.chat_stream(request)
    state = StreamState(provider=provider.name)

    for chunk in stream:
        parsed = _parse_chunk(provider, chunk)
        if not parsed:
            continue
        _update_stream_metadata(state, parsed)
        yield from _handle_stream_delta(state, parsed)
        if parsed.usage:
            state.latest_usage = parsed.usage

    message = _finalize_stream_message(state)
    return StreamOutcome(
        message=message,
        usage=state.latest_usage,
        provider=state.provider,
        finish_reason=state.finish_reason,
        response_model=state.response_model,
    )


def _parse_chunk(provider: ChatProvider, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
    """Parse a raw chunk into a normalized delta structure."""
    if not isinstance(chunk, dict):
        return None
    return provider.parse_stream_chunk(chunk)


def _update_stream_metadata(state: StreamState, parsed: ParsedStreamChunk) -> None:
    """Update shared metadata fields from a parsed chunk."""
    if parsed.provider:
        state.provider = parsed.provider
    if parsed.response_model:
        state.response_model = parsed.response_model
    if parsed.finish_reason:
        state.finish_reason = parsed.finish_reason


def _handle_stream_delta(
    state: StreamState,
    parsed: ParsedStreamChunk,
) -> Generator[dict[str, Any], None, None]:
    """Apply a parsed delta to state and emit stream events."""
    token_text = coerce_stream_text(parsed.delta_content)
    if token_text:
        state.content_parts.append(token_text)
        yield {"type": "token", "content": token_text}

    if parsed.tool_calls:
        accumulate_stream_tool_calls(state.tool_call_fragments, parsed.tool_calls)

    if parsed.reasoning:
        reasoning_update = normalize_reasoning_segments(parsed.reasoning)
        if reasoning_update:
            extend_reasoning_segments(state.reasoning_segments, reasoning_update)
            yield {
                "type": "reasoning",
                "segments": [dict(segment) for segment in state.reasoning_segments],
            }


def _finalize_stream_message(state: StreamState) -> dict[str, Any]:
    """Build the final assistant message from stream state."""
    tool_calls: list[dict[str, Any]] = []
    for index in sorted(state.tool_call_fragments.keys()):
        call_entry = state.tool_call_fragments[index]
        function_block = call_entry.get("function") or {}
        name = function_block.get("name")
        arguments_value = function_block.get("arguments") or ""
        if not name:
            continue
        tool_calls.append(
            {
                "id": call_entry.get("id") or f"tool_call_{uuid4().hex}",
                "type": call_entry.get("type") or "function",
                "function": {
                    "name": name,
                    "arguments": arguments_value,
                },
            }
        )

    message: dict[str, Any] = {"content": "".join(state.content_parts)}
    if tool_calls:
        message["tool_calls"] = tool_calls
    if state.reasoning_segments:
        message["reasoning"] = [dict(segment) for segment in state.reasoning_segments]
    return message
