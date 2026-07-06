"""Typed SSE stream events — the wire contract for `/api/chat/stream`.

Each model's field order matches its historical dict literal exactly
(`model_dump()` preserves declaration order), so serializing an event model
through the same `jsonable_encoder` + `json.dumps` pipeline the route already
uses (`app/api/routes/chat.py::format_event`) produces byte-identical SSE
frames to the pre-4.1 dict-based events. See
`tests/api/test_chat_stream_events.py` for the byte-identity guard.

`TokenEvent`/`ReasoningEvent` are defined here as the formal contract but are
still constructed as plain dicts in `app/chat/streaming.py` —
that generator is exercised directly by a deliberately garbage-tolerant test
suite (`tests/chat/test_chat_streaming.py`) that depends on
malformed/partial event dicts passing through unchanged. Validating every
event at that point would be a real (out-of-scope) behavior change; the run
loop forwards those dicts unmodified today, and they already conform to this
contract's shape. `ToolCallEvent`/`ToolResultEvent`/`FinalEvent`/`ErrorEvent`
are constructed directly at their single origination points
(`app/chat/tools.py`, `app/chat/run_loop.py`, `app/api/routes/chat.py`),
since those sites build the event fresh rather than forwarding one.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.schemas.retrieval import CollectionQueryResponse


class TokenEvent(BaseModel):
    """A streamed content token from the assistant."""

    type: Literal["token"] = "token"
    content: str


class ReasoningEvent(BaseModel):
    """Accumulated reasoning segments emitted during streaming."""

    type: Literal["reasoning"] = "reasoning"
    segments: list[dict[str, Any]]


class ToolCallEvent(BaseModel):
    """A tool call the assistant is invoking, before its result is known."""

    type: Literal["tool_call"] = "tool_call"
    id: str | None
    name: str
    arguments: dict[str, Any]
    reasoning: dict[str, Any] | None = None
    collection_id: str
    collection_name: str


class ToolResultEvent(BaseModel):
    """The result of an executed tool call."""

    type: Literal["tool_result"] = "tool_result"
    id: str | None
    name: str
    arguments: dict[str, Any]
    response: CollectionQueryResponse
    reasoning: dict[str, Any] | None = None
    collection_id: str
    collection_name: str


class FinalEvent(BaseModel):
    """The final assistant response payload for the turn."""

    type: Literal["final"] = "final"
    payload: dict[str, Any]


class ErrorEvent(BaseModel):
    """A stream-terminating error.

    Field is named `message` (not `detail`) to match the wire shape the
    frontend already consumes from `app/api/routes/chat.py`'s stream error
    handler — preserving the existing SSE contract took priority here.
    """

    type: Literal["error"] = "error"
    message: str


ChatStreamEvent = Annotated[
    TokenEvent | ReasoningEvent | ToolCallEvent | ToolResultEvent | FinalEvent | ErrorEvent,
    Field(discriminator="type"),
]
