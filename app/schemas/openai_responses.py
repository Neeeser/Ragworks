"""Wire shapes for the OpenAI Responses API.

Modelled against the installed `openai` SDK's `Response` and
`ResponseStreamEvent` types rather than from memory. Only the items this app
consumes are named — assistant text, function calls, and reasoning — and every
model allows extras, so a tool type we do not handle (web search, code
interpreter, MCP) parses and is skipped instead of failing the turn.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ResponsesUsage(BaseModel):
    """Token accounting on a Responses payload.

    The field names differ from Chat Completions (`input_tokens` rather than
    `prompt_tokens`); the dialect translates them so usage records stay
    comparable across providers.
    """

    model_config = ConfigDict(extra="allow")

    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    input_tokens_details: dict[str, Any] | None = None
    output_tokens_details: dict[str, Any] | None = None


class ResponsesTextContent(BaseModel):
    """One text (or refusal) part inside an assistant message item."""

    model_config = ConfigDict(extra="allow")

    type: str | None = None
    text: str | None = None
    refusal: str | None = None


class ResponsesOutputItem(BaseModel):
    """One item in a response's `output` list.

    A single permissive model covers every item type because the discriminator
    is `type` and the fields we read are disjoint per type — modelling the full
    SDK union would pin us to the exact set of tools OpenAI shipped this month.
    """

    model_config = ConfigDict(extra="allow")

    type: str | None = None
    id: str | None = None
    role: str | None = None
    status: str | None = None
    # type == "message"
    content: list[ResponsesTextContent] | None = None
    # type == "function_call"
    call_id: str | None = None
    name: str | None = None
    arguments: str | None = None
    # type == "reasoning"
    summary: list[dict[str, Any]] | None = None


class ResponsesError(BaseModel):
    """The error envelope a failed response carries."""

    model_config = ConfigDict(extra="allow")

    code: str | None = None
    message: str | None = None


class ResponsesResponse(BaseModel):
    """Top-level Responses API payload."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    model: str | None = None
    status: str | None = None
    output: list[ResponsesOutputItem] = Field(default_factory=list)
    usage: ResponsesUsage | None = None
    error: ResponsesError | None = None
    incomplete_details: dict[str, Any] | None = None


class ResponsesStreamEvent(BaseModel):
    """One semantic event from a streaming Responses call.

    Responses streams named events rather than deltas on a choice, so `type` is
    the only field guaranteed present; which of the rest is populated depends
    on it. `sequence_number` is carried because it is the only ordering signal
    the stream provides.
    """

    model_config = ConfigDict(extra="allow")

    type: str
    sequence_number: int | None = None
    #: Text/reasoning/argument increments (`*.delta` events).
    delta: str | None = None
    #: Item identity for the tool-call events.
    item_id: str | None = None
    output_index: int | None = None
    item: ResponsesOutputItem | None = None
    #: Present on the terminal `response.*` lifecycle events.
    response: ResponsesResponse | None = None
    #: Present on `error`.
    code: str | None = None
    message: str | None = None


#: Terminal lifecycle events that carry the finished `response` payload.
TERMINAL_EVENTS: frozenset[str] = frozenset(
    {"response.completed", "response.incomplete", "response.failed"}
)

#: Event whose `delta` is assistant-visible text.
TEXT_DELTA_EVENT: Literal["response.output_text.delta"] = "response.output_text.delta"

#: Events whose `delta` is reasoning. Both are emitted depending on whether the
#: model returns summarized reasoning or raw reasoning text.
REASONING_DELTA_EVENTS: frozenset[str] = frozenset(
    {"response.reasoning_summary_text.delta", "response.reasoning_text.delta"}
)
