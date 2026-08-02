"""Pure translation between Chat Completions shapes and the Responses API.

The app's internal history is OpenAI Chat Completions-shaped — that is what the
chat subsystem persists and what every other dialect reads. The Responses API
uses a different vocabulary for the same facts: a flat `input` list of typed
items instead of `messages`, `function_call` / `function_call_output` items
instead of `tool_calls` / `role: "tool"`, and flat tool definitions instead of
`{"type": "function", "function": {...}}`. Keeping the mapping here, with no
I/O, is what lets it be tested directly against captured payload shapes.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from app.schemas.openai_responses import ResponsesResponse, ResponsesUsage

#: Roles the Responses `input` list accepts verbatim as message items.
_MESSAGE_ROLES = frozenset({"system", "developer", "user", "assistant"})


def _flatten_content(content: Any) -> str:
    """Flatten Chat Completions content (string or part list) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") in ("text", "input_text")
        )
    return "" if content is None else str(content)


def _assistant_items(message: dict[str, Any], text: str) -> list[dict[str, Any]]:
    """Convert one assistant turn, which may carry text and/or tool calls."""
    items: list[dict[str, Any]] = []
    if text:
        items.append({"role": "assistant", "content": text})
    for call in message.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        function = call.get("function") or {}
        call_id = call.get("id")
        if not call_id:
            # Responses pairs a call with its output by `call_id`; an unpaired
            # call would make the next request fail validation on the output
            # item that references an id the model never saw.
            continue
        items.append(
            {
                "type": "function_call",
                "call_id": str(call_id),
                "name": str(function.get("name") or ""),
                "arguments": function.get("arguments") or "{}",
            }
        )
    return items


def messages_to_input(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert Chat Completions messages into a Responses `input` list."""
    items: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        text = _flatten_content(message.get("content"))
        if role == "assistant":
            items.extend(_assistant_items(message, text))
        elif role == "tool":
            call_id = message.get("tool_call_id")
            if call_id:
                items.append(
                    {
                        "type": "function_call_output",
                        "call_id": str(call_id),
                        "output": text,
                    }
                )
        elif role in _MESSAGE_ROLES:
            items.append({"role": role, "content": text})
        else:
            items.append({"role": "user", "content": text})
    return items


def tools_to_responses(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    """Flatten Chat Completions tool definitions into Responses tool objects."""
    if not tools:
        return None
    converted: list[dict[str, Any]] = []
    for tool in tools:
        function = tool.get("function") if isinstance(tool, dict) else None
        if not isinstance(function, dict):
            continue
        entry: dict[str, Any] = {
            "type": "function",
            "name": function.get("name"),
            "parameters": function.get("parameters") or {"type": "object", "properties": {}},
        }
        description = function.get("description")
        if description:
            entry["description"] = description
        converted.append(entry)
    return converted or None


def usage_to_chat_shape(usage: ResponsesUsage | None) -> dict[str, Any]:
    """Rename Responses token counters onto the shared usage vocabulary.

    Usage records are compared across providers, so a Responses turn that
    reported `input_tokens` while every other dialect reported `prompt_tokens`
    would read as a turn that consumed no prompt at all.
    """
    if usage is None:
        return {}
    shaped: dict[str, Any] = {}
    if usage.input_tokens is not None:
        shaped["prompt_tokens"] = usage.input_tokens
    if usage.output_tokens is not None:
        shaped["completion_tokens"] = usage.output_tokens
    if usage.total_tokens is not None:
        shaped["total_tokens"] = usage.total_tokens
    if usage.input_tokens_details:
        shaped["prompt_tokens_details"] = usage.input_tokens_details
    if usage.output_tokens_details:
        shaped["completion_tokens_details"] = usage.output_tokens_details
    return shaped


def _reasoning_text(item_summary: list[dict[str, Any]] | None) -> str:
    """Join a reasoning item's summary parts into displayable text."""
    if not item_summary:
        return ""
    return "".join(str(part.get("text", "")) for part in item_summary if isinstance(part, dict))


def response_to_message(response: ResponsesResponse) -> dict[str, Any]:
    """Convert a finished Responses payload into a Chat Completions message."""
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for item in response.output:
        if item.type == "message":
            text_parts.extend(part.text for part in item.content or [] if part.text is not None)
        elif item.type == "function_call":
            tool_calls.append(
                {
                    "id": item.call_id or item.id or "",
                    "type": "function",
                    "function": {
                        "name": item.name or "",
                        "arguments": item.arguments or "{}",
                    },
                }
            )
        elif item.type == "reasoning":
            reasoning_parts.append(_reasoning_text(item.summary))
    message: dict[str, Any] = {"role": "assistant", "content": "".join(text_parts)}
    reasoning = "".join(reasoning_parts)
    if reasoning:
        message["reasoning"] = reasoning
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message


def response_error_text(response: ResponsesResponse) -> str | None:
    """Return a human-readable failure message when the response carries one."""
    if response.error is not None and response.error.message:
        return response.error.message
    details = response.incomplete_details
    if isinstance(details, dict) and details.get("reason"):
        return f"Response incomplete: {details['reason']}"
    return None


def encode_arguments(arguments: Any) -> str:
    """Return tool-call arguments as the JSON string the shared shape expects."""
    if isinstance(arguments, str):
        return arguments
    return json.dumps(arguments or {})
