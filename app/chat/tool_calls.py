"""Tool call normalization and parsing helpers for chat workflows."""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from pydantic import BaseModel

from app.chat.messages import FunctionCall, ToolCall
from app.chat.reasoning import extend_reasoning_segments, normalize_reasoning_segments

_CANDIDATE_TOOL_TYPES = {"tool_call", "tool_use", "tool_request", "call_tool", "function_call"}


class ParsedToolCall(BaseModel):
    """A tool call normalized into the fields `ChatService` needs to execute it."""

    id: str | None
    name: str
    arguments: dict[str, Any]
    query_text: str
    top_k: int


class ToolResultPayload(BaseModel):
    """The persisted/replayed payload for one executed tool call.

    Field order matches the historical dict literal
    (`{"collection_id": ..., "collection_name": ..., "arguments": ...,
    "response": ...}`) so `.model_dump()` reproduces it exactly for storage
    (`tool_payload` column) and for the JSON string sent back to the
    provider as the `tool` message content.
    """

    collection_id: str
    collection_name: str
    arguments: dict[str, Any]
    response: Any


def parse_tool_call(
    tool_call: dict[str, Any],
    *,
    default_query: str,
    use_fallback_id: bool,
) -> ParsedToolCall:
    """Parse a raw tool call payload into a `ParsedToolCall`.

    `default_query` is the fallback search text (the user's message content)
    when the tool call's own arguments don't specify a `query`/`text`.
    """
    function_block = tool_call.get("function") or {}
    if not isinstance(function_block, dict):
        function_block = {}
    name = function_block.get("name") or "tool_call"
    arguments = decode_tool_arguments(function_block.get("arguments"))
    call_id = tool_call.get("id")
    if use_fallback_id and not call_id:
        call_id = f"tool_call_{uuid4().hex}"
    query_text = arguments.get("query") or arguments.get("text") or default_query
    try:
        top_k = int(arguments.get("top_k", 5))
    except (TypeError, ValueError):
        top_k = 5
    top_k = max(1, min(10, top_k))
    return ParsedToolCall(
        id=call_id,
        name=name,
        arguments=arguments,
        query_text=query_text,
        top_k=top_k,
    )


def _resolve_call_components(segment: dict[str, Any]) -> tuple[str, str, str] | None:
    """Extract call id, name, and arguments string from a reasoning segment."""
    segment_type = str(segment.get("type") or "").lower()
    raw_function = segment.get("function")
    raw_call = segment.get("call")
    has_function = isinstance(raw_function, dict)
    has_call = isinstance(raw_call, dict)
    if not (segment_type in _CANDIDATE_TOOL_TYPES or has_function or has_call):
        return None
    function_payload: dict[str, Any] = raw_function if isinstance(raw_function, dict) else {}
    call_payload: dict[str, Any] = raw_call if isinstance(raw_call, dict) else {}
    name = (
        function_payload.get("name")
        or call_payload.get("name")
        or segment.get("name")
        or segment.get("tool_name")
        or segment.get("function_name")
    )
    if not name:
        return None
    arguments_source = (
        function_payload.get("arguments")
        or call_payload.get("arguments")
        or call_payload.get("input")
        or segment.get("arguments")
        or segment.get("input")
        or segment.get("params")
        or segment.get("parameters")
    )
    call_id = str(
        segment.get("id")
        or segment.get("tool_call_id")
        or segment.get("call_id")
        or call_payload.get("id")
        or function_payload.get("id")
        or f"reasoning_tool_{uuid4().hex}"
    )
    arguments_str = ensure_arguments_string(arguments_source)
    return call_id, str(name), arguments_str


def ensure_arguments_string(arguments: Any) -> str:
    """Ensure tool arguments are encoded as a JSON string."""
    if isinstance(arguments, str):
        stripped = arguments.strip()
        if not stripped:
            return "{}"
        try:
            json.loads(stripped)
            return stripped
        except json.JSONDecodeError:
            return json.dumps({"input": stripped})
    if arguments is None:
        return "{}"
    return json.dumps(arguments)


def decode_tool_arguments(arguments: Any) -> dict[str, Any]:
    """Parse tool arguments into a dictionary payload."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        stripped = arguments.strip()
        if not stripped:
            return {}
        try:
            decoded = json.loads(stripped)
            if isinstance(decoded, dict):
                return decoded
        except json.JSONDecodeError:
            return {"query": stripped}
    return {}


def normalize_tool_calls(
    tool_calls: list[dict[str, Any]],
    processed_ids: set[str],
) -> list[ToolCall]:
    """Normalize raw provider tool-call payloads into typed `ToolCall` models.

    This is the lenient boundary for *fresh* provider output: entries without a
    usable function/name are dropped, missing ids are backfilled, and arguments
    are coerced to a JSON string — so every `ToolCall` leaving here is regular
    by construction (`model_dump()` reproduces the exact OpenAI wire shape).
    """
    normalized: list[ToolCall] = []
    for call in tool_calls:
        function_payload = call.get("function") or {}
        if not isinstance(function_payload, dict):
            continue
        name = function_payload.get("name")
        if not name:
            continue
        arguments_str = ensure_arguments_string(function_payload.get("arguments"))
        call_id = str(call.get("id") or f"tool_call_{uuid4().hex}")
        processed_ids.add(call_id)
        normalized.append(
            ToolCall(
                id=call_id,
                function=FunctionCall(name=str(name), arguments=arguments_str),
            )
        )
    return normalized


def extract_reasoning_tool_calls(
    reasoning_segments: list[dict[str, Any]],
    processed_ids: set[str],
) -> tuple[list[ToolCall], dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Extract typed tool calls from reasoning segments.

    Feeds the same execution pipe as `normalize_tool_calls`, so it produces the
    same `ToolCall` models (ids are always resolved or generated here).
    """
    tool_calls: list[ToolCall] = []
    context: dict[str, dict[str, Any]] = {}
    residual_segments: list[dict[str, Any]] = []
    pending_context: list[dict[str, Any]] = []
    for segment in reasoning_segments:
        pending_context.append(segment)
        resolved = _resolve_call_components(segment)
        if not resolved:
            continue
        call_id, name, arguments_str = resolved
        if call_id not in processed_ids:
            processed_ids.add(call_id)
            tool_calls.append(
                ToolCall(
                    id=call_id,
                    function=FunctionCall(name=name, arguments=arguments_str),
                )
            )
        if call_id in context and "segments" in context[call_id]:
            context[call_id]["segments"].extend(pending_context)
        else:
            context[call_id] = {"segments": list(pending_context)}
        pending_context = []
    if pending_context:
        residual_segments.extend(pending_context)
    return tool_calls, context, residual_segments


def coerce_stream_text(content: Any) -> str | None:
    """Extract text content from streamed delta payloads."""
    if content is None:
        return None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
        return "".join(parts) or None
    if isinstance(content, dict):
        text_value = content.get("text")
        if isinstance(text_value, str):
            return text_value
    return str(content)


def accumulate_stream_tool_calls(
    accumulator: dict[int, dict[str, Any]],
    updates: list[dict[str, Any]],
) -> None:
    """Accumulate tool call deltas into a consolidated mapping."""
    for update in updates:
        if not isinstance(update, dict):
            continue
        index_value = update.get("index")
        try:
            index = int(index_value) if index_value is not None else 0
        except (TypeError, ValueError):
            index = 0
        entry = accumulator.setdefault(
            index,
            {
                "id": update.get("id"),
                "type": update.get("type") or "function",
                "function": {"name": None, "arguments": ""},
            },
        )
        if update.get("id"):
            entry["id"] = update["id"]
        if update.get("type"):
            entry["type"] = update["type"]
        function_payload = update.get("function")
        if not isinstance(function_payload, dict):
            continue
        function_block = entry.setdefault("function", {"name": None, "arguments": ""})
        if function_payload.get("name"):
            function_block["name"] = function_payload["name"]
        arguments_fragment = function_payload.get("arguments")
        if isinstance(arguments_fragment, str):
            prior_arguments = function_block.get("arguments") or ""
            function_block["arguments"] = prior_arguments + arguments_fragment


def merge_reasoning_segments(
    reasoning: Any,
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Normalize and append reasoning segments onto an existing list."""
    reasoning_update = normalize_reasoning_segments(reasoning)
    if reasoning_update:
        extend_reasoning_segments(segments, reasoning_update)
    return segments
