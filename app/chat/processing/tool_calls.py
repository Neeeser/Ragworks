"""Tool call normalization and parsing helpers for chat workflows."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

from app.chat.processing.reasoning import extend_reasoning_segments
from app.chat.processing.reasoning import normalize_reasoning_segments

_CANDIDATE_TOOL_TYPES = {"tool_call", "tool_use", "tool_request", "call_tool", "function_call"}


def _resolve_call_components(segment: Dict[str, Any]) -> Optional[Tuple[str, str, str]]:
    """Extract call id, name, and arguments string from a reasoning segment."""
    segment_type = str(segment.get("type") or "").lower()
    has_function = isinstance(segment.get("function"), dict)
    has_call = isinstance(segment.get("call"), dict)
    if not (segment_type in _CANDIDATE_TOOL_TYPES or has_function or has_call):
        return None
    function_payload = segment.get("function") if has_function else {}
    call_payload = segment.get("call") if has_call else {}
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


def decode_tool_arguments(arguments: Any) -> Dict[str, Any]:
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
    tool_calls: List[Dict[str, Any]],
    processed_ids: Set[str],
) -> List[Dict[str, Any]]:
    """Normalize tool call payloads and deduplicate ids."""
    normalized: List[Dict[str, Any]] = []
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
            {
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": arguments_str},
            }
        )
    return normalized


def extract_reasoning_tool_calls(
    reasoning_segments: List[Dict[str, Any]],
    processed_ids: Set[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """Extract tool calls from reasoning segments."""
    tool_calls: List[Dict[str, Any]] = []
    context: Dict[str, Dict[str, Any]] = {}
    residual_segments: List[Dict[str, Any]] = []
    pending_context: List[Dict[str, Any]] = []
    for segment in reasoning_segments:
        pending_context.append(segment)
        resolved = _resolve_call_components(segment)
        if not resolved:
            continue
        call_id, name, arguments_str = resolved
        if call_id not in processed_ids:
            processed_ids.add(call_id)
            tool_calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments_str},
                }
            )
        if call_id in context and "segments" in context[call_id]:
            context[call_id]["segments"].extend(pending_context)
        else:
            context[call_id] = {"segments": list(pending_context)}
        pending_context = []
    if pending_context:
        residual_segments.extend(pending_context)
    return tool_calls, context, residual_segments


def coerce_stream_text(content: Any) -> Optional[str]:
    """Extract text content from streamed delta payloads."""
    if content is None:
        return None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
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
    accumulator: Dict[int, Dict[str, Any]],
    updates: List[Dict[str, Any]],
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
    segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Normalize and append reasoning segments onto an existing list."""
    reasoning_update = normalize_reasoning_segments(reasoning)
    if reasoning_update:
        extend_reasoning_segments(segments, reasoning_update)
    return segments
