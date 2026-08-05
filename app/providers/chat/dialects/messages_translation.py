"""Pure translation between Chat Completions shapes and Anthropic Messages.

Four differences do the work here. Anthropic carries the system prompt as a
top-level `system` string rather than a message; a tool call is a `tool_use`
content block whose `input` is a real object rather than a JSON *string*; a
tool result is a `tool_result` block on a **user** turn rather than a `tool`
role; and `max_tokens` is required rather than optional.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from app.providers.chat.content import split_data_uri
from app.schemas.anthropic import MessagesResponse, MessagesUsage

#: Anthropic stop reasons mapped onto the Chat Completions vocabulary the chat
#: subsystem branches on. `tool_use` in particular must become `tool_calls`, or
#: the run loop never executes the tools the model asked for.
_STOP_REASONS = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
    "refusal": "content_filter",
}


def map_stop_reason(stop_reason: str | None) -> str | None:
    """Translate an Anthropic stop reason to its Chat Completions equivalent."""
    if stop_reason is None:
        return None
    return _STOP_REASONS.get(stop_reason, stop_reason)


def _flatten_content(content: Any) -> str:
    """Flatten Chat Completions content (string or part list) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return "" if content is None else str(content)


def _image_blocks(content: Any) -> list[dict[str, Any]]:
    """Convert Chat Completions image parts into Anthropic image blocks.

    Anthropic takes inline bytes as a base64 source, so a part carrying a
    remote URL is dropped rather than forwarded: sending the URL string as
    if it were encoded bytes fails inside the provider with an error that
    names neither the image nor the reason.
    """
    if not isinstance(content, list):
        return []
    blocks: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict) or part.get("type") != "image_url":
            continue
        holder = part.get("image_url")
        url = holder.get("url") if isinstance(holder, dict) else None
        split = split_data_uri(url) if isinstance(url, str) else None
        if split is None:
            continue
        media_type, payload = split
        blocks.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": payload},
            }
        )
    return blocks


def _decode_arguments(raw: Any) -> dict[str, Any]:
    """Decode a tool call's JSON-string arguments into the object Anthropic wants."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            decoded = json.loads(raw)
        except ValueError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _assistant_content(message: dict[str, Any], text: str) -> list[dict[str, Any]]:
    """Build the content blocks for one assistant turn."""
    blocks: list[dict[str, Any]] = []
    if text:
        blocks.append({"type": "text", "text": text})
    for call in message.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        function = call.get("function") or {}
        call_id = call.get("id")
        if not call_id:
            # Anthropic pairs a `tool_use` with its `tool_result` by id; an
            # unpaired call makes the next request 400 on the result block.
            continue
        blocks.append(
            {
                "type": "tool_use",
                "id": str(call_id),
                "name": str(function.get("name") or ""),
                "input": _decode_arguments(function.get("arguments")),
            }
        )
    return blocks


def split_system(
    messages: Iterable[dict[str, Any]],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Split system turns out of the history into Anthropic's `system` field.

    System turns are joined rather than dropped: a chat session can accumulate
    several (the base prompt plus retrieved context), and keeping only the
    first would silently discard the instructions the rest carry.
    """
    system_parts: list[str] = []
    rest: list[dict[str, Any]] = []
    for message in messages:
        if str(message.get("role") or "") in ("system", "developer"):
            text = _flatten_content(message.get("content"))
            if text:
                system_parts.append(text)
        else:
            rest.append(message)
    return ("\n\n".join(system_parts) or None), rest


def messages_to_anthropic(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert Chat Completions messages into Anthropic message turns.

    An empty assistant turn is dropped: Anthropic rejects a message whose
    content list is empty, and a turn that carried only an unpaired tool call
    reduces to exactly that.
    """
    converted: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        text = _flatten_content(message.get("content"))
        if role == "assistant":
            blocks = _assistant_content(message, text)
            if blocks:
                converted.append({"role": "assistant", "content": blocks})
        elif role == "tool":
            call_id = message.get("tool_call_id")
            if call_id:
                converted.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": str(call_id),
                                "content": text,
                            }
                        ],
                    }
                )
        else:
            images = _image_blocks(message.get("content"))
            if images:
                text_blocks = [{"type": "text", "text": text}] if text else []
                converted.append({"role": "user", "content": [*text_blocks, *images]})
            elif text:
                converted.append({"role": "user", "content": text})
    return converted


def tools_to_anthropic(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    """Flatten Chat Completions tool definitions into Anthropic tool objects."""
    if not tools:
        return None
    converted: list[dict[str, Any]] = []
    for tool in tools:
        function = tool.get("function") if isinstance(tool, dict) else None
        if not isinstance(function, dict):
            continue
        entry: dict[str, Any] = {
            "name": function.get("name"),
            "input_schema": function.get("parameters") or {"type": "object", "properties": {}},
        }
        description = function.get("description")
        if description:
            entry["description"] = description
        converted.append(entry)
    return converted or None


def usage_to_chat_shape(usage: MessagesUsage | None) -> dict[str, Any]:
    """Rename Anthropic token counters onto the shared usage vocabulary."""
    if usage is None:
        return {}
    shaped: dict[str, Any] = {}
    if usage.input_tokens is not None:
        shaped["prompt_tokens"] = usage.input_tokens
    if usage.output_tokens is not None:
        shaped["completion_tokens"] = usage.output_tokens
    if usage.input_tokens is not None and usage.output_tokens is not None:
        shaped["total_tokens"] = usage.input_tokens + usage.output_tokens
    if usage.cache_read_input_tokens is not None:
        shaped["prompt_tokens_details"] = {"cached_tokens": usage.cache_read_input_tokens}
    return shaped


def response_to_message(response: MessagesResponse) -> dict[str, Any]:
    """Convert a finished Messages payload into a Chat Completions message."""
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for block in response.content:
        if block.type == "text" and block.text:
            text_parts.append(block.text)
        elif block.type == "thinking" and block.thinking:
            reasoning_parts.append(block.thinking)
        elif block.type == "tool_use":
            tool_calls.append(
                {
                    "id": block.id or "",
                    "type": "function",
                    "function": {
                        "name": block.name or "",
                        "arguments": json.dumps(block.input or {}),
                    },
                }
            )
    message: dict[str, Any] = {"role": "assistant", "content": "".join(text_parts)}
    reasoning = "".join(reasoning_parts)
    if reasoning:
        message["reasoning"] = reasoning
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message
