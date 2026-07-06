"""Reasoning segment normalization for chat responses."""

from __future__ import annotations

import json
from typing import Any


def normalize_reasoning_segments(raw_reasoning: Any) -> list[dict[str, Any]]:
    """Normalize reasoning payloads into a list of segment dicts."""
    if raw_reasoning is None:
        return []
    segments: list[dict[str, Any]]
    if isinstance(raw_reasoning, str):
        segments = _normalize_string_reasoning(raw_reasoning)
    elif isinstance(raw_reasoning, dict):
        segments = [raw_reasoning]
    elif isinstance(raw_reasoning, list):
        segments = _normalize_list_reasoning(raw_reasoning)
    else:
        segments = [{"type": "text", "content": str(raw_reasoning)}]
    return merge_reasoning_segment_list(segments)


def _normalize_string_reasoning(raw_reasoning: str) -> list[dict[str, Any]]:
    """Normalize string reasoning payloads."""
    if not raw_reasoning.strip():
        return [{"type": "text", "content": raw_reasoning}]
    try:
        parsed = json.loads(raw_reasoning)
    except json.JSONDecodeError:
        return [{"type": "text", "content": raw_reasoning}]
    return normalize_reasoning_segments(parsed)


def _normalize_list_reasoning(raw_reasoning: list[Any]) -> list[dict[str, Any]]:
    """Normalize list reasoning payloads."""
    segments: list[dict[str, Any]] = []
    for item in raw_reasoning:
        if isinstance(item, dict):
            segments.append(dict(item))
        elif isinstance(item, str):
            text_value = item.strip()
            if text_value:
                segments.append({"type": "text", "content": text_value})
        else:
            segments.append({"type": "value", "content": item})
    return segments


def merge_reasoning_segment_list(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge a list of reasoning segments into normalized entries."""
    merged: list[dict[str, Any]] = []
    extend_reasoning_segments(merged, segments)
    return merged


def extend_reasoning_segments(
    destination: list[dict[str, Any]],
    additions: list[dict[str, Any]],
) -> None:
    """Append reasoning segments into a destination list."""
    for addition in additions:
        if isinstance(addition, dict):
            append_reasoning_segment(destination, dict(addition))


_MERGEABLE_REASONING_TYPES = {"text", "", "reasoning.text"}


def _extract_segment_text(entry: dict[str, Any]) -> str | None:
    """Return the first string text carried by a reasoning segment, if any."""
    for key in ("text", "content", "value"):
        value = entry.get(key)
        if isinstance(value, str):
            return value
    return None


def _segment_ids_compatible(last: dict[str, Any], entry: dict[str, Any]) -> bool:
    """Return True when two segments share (or both omit) every call-id key."""
    for key in ("id", "call_id", "tool_call_id"):
        left = last.get(key)
        right = entry.get(key)
        if (left is None) ^ (right is None):
            return False
        if left is not None and right is not None and left != right:
            return False
    return True


def append_reasoning_segment(target: list[dict[str, Any]], segment: dict[str, Any]) -> None:
    """Append or merge a reasoning segment into a target list."""
    if not segment:
        return
    entry = dict(segment)
    segment_type = str(entry.get("type") or "").lower()
    if not segment_type and (entry.get("text") or entry.get("content")):
        segment_type = "text"
        entry["type"] = "text"
    text_value = _extract_segment_text(entry)
    can_merge = (
        bool(target)
        and bool(text_value)
        and segment_type in _MERGEABLE_REASONING_TYPES
        and str(target[-1].get("type") or "").lower() in _MERGEABLE_REASONING_TYPES
        and _segment_ids_compatible(target[-1], entry)
    )
    if can_merge and text_value is not None:
        last = target[-1]
        existing_text = last.get("text") or last.get("content") or ""
        last_text = join_text_with_spacing(existing_text, text_value)
        last["text"] = last_text
        last["content"] = last_text
        return
    if text_value is not None:
        entry["text"] = text_value
        entry["content"] = text_value
    target.append(entry)


def join_text_with_spacing(left: str, right: str) -> str:
    """Join two text fragments with consistent spacing."""
    if not left:
        return right
    if not right:
        return left
    return left + right
