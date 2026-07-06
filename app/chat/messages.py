"""Provider-message wire vocabulary for chat request construction.

`ProviderMessage` models the messages an OpenRouter-compatible chat
completion endpoint expects in its request body.

Adoption status (fully wired as of Task 4.3):

- `ToolCall`/`FunctionCall` flow through the fresh tool-call path:
  `tool_calls.py::normalize_tool_calls`/`extract_reasoning_tool_calls` return
  `list[ToolCall]`, which the run loop feeds into `tools.py::ToolExecutor.execute`.
- The full `ProviderMessage` union IS the message-history vocabulary:
  `ChatSetup.messages` is `list[ProviderMessage]`. `persistence.py`
  reads persisted rows into typed messages at the read boundary
  (`provider_message_from_model`, lenient about legacy on-disk `tool_calls`
  shapes missing `type`/`function`) and `serialize_messages` renders them back
  to provider request dicts only at the request boundary.

`normalize_assistant_content` coerces a provider-returned assistant `content`
(string or list-of-parts) into a single string.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field


class FunctionCall(BaseModel):
    """A tool call's function name and JSON-encoded argument string."""

    name: str
    arguments: str


class ToolCall(BaseModel):
    """A single tool call requested by the assistant."""

    id: str
    type: Literal["function"] = "function"
    function: FunctionCall


class SystemMessage(BaseModel):
    """A system prompt message."""

    role: Literal["system"] = "system"
    content: str


class UserMessage(BaseModel):
    """A user-authored message."""

    role: Literal["user"] = "user"
    content: str


class AssistantMessage(BaseModel):
    """An assistant message, optionally requesting tool calls."""

    role: Literal["assistant"] = "assistant"
    content: str
    tool_calls: list[ToolCall] | None = None


class ToolMessage(BaseModel):
    """A tool result message replying to a specific tool call."""

    role: Literal["tool"] = "tool"
    tool_call_id: str | None
    content: str


ProviderMessage = Annotated[
    SystemMessage | UserMessage | AssistantMessage | ToolMessage,
    Field(discriminator="role"),
]


def normalize_assistant_content(content: Any) -> str:
    """Coerce a provider-returned assistant `content` value into a string.

    Providers can return assistant content either as a plain string or as a
    list of content-part dicts (e.g. `[{"type": "output_text", "text": ...}]`);
    this JSON-encodes the list case so callers always get a single string,
    falling back to `""` for `None`/empty content.
    """
    if isinstance(content, list):
        return json.dumps(content)
    return content or ""
