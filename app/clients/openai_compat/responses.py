"""OpenAI Responses API calls.

The Responses API is a different wire format from Chat Completions, not a
wrapper over it: input is a flat `input` list of typed items rather than
`messages`, tools are flat objects rather than `{"type": "function",
"function": {...}}`, output is a list of typed items rather than a `choices`
array, and streaming emits named semantic events rather than deltas on a
choice. It shares this package because it shares the *transport* — the same
base URL, key, and pool — which is the whole reason the transport is separate
from the dialect.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from app.clients.openai_compat.transport import OpenAICompatTransport
from app.schemas.openai_responses import ResponsesResponse, ResponsesStreamEvent


@dataclass(frozen=True)
class ResponsesCall:
    """One Responses API invocation."""

    input: list[dict[str, Any]]
    model: str
    instructions: str | None = None
    tools: list[dict[str, Any]] | None = None
    parallel_tool_calls: bool | None = None
    reasoning: dict[str, Any] | None = None
    parameters: dict[str, Any] | None = None
    extra_headers: dict[str, str] | None = None


def _build_kwargs(
    transport: OpenAICompatTransport, call: ResponsesCall, *, stream: bool
) -> dict[str, Any]:
    """Assemble the SDK kwargs shared by the streaming and buffered paths."""
    kwargs: dict[str, Any] = {"input": call.input, "model": call.model, "store": False}
    if call.instructions:
        kwargs["instructions"] = call.instructions
    if call.tools:
        kwargs["tools"] = call.tools
    if call.parallel_tool_calls is not None:
        kwargs["parallel_tool_calls"] = call.parallel_tool_calls
    if call.reasoning:
        kwargs["reasoning"] = call.reasoning
    headers = transport.merge_headers(call.extra_headers)
    if headers:
        kwargs["extra_headers"] = headers
    if call.parameters:
        kwargs.update(
            {key: value for key, value in call.parameters.items() if value is not None}
        )
    if stream:
        kwargs["stream"] = True
    return kwargs


def create_response(
    transport: OpenAICompatTransport, call: ResponsesCall
) -> ResponsesResponse:
    """Request a buffered Responses-API completion."""
    response = transport.sdk.responses.create(**_build_kwargs(transport, call, stream=False))
    return ResponsesResponse.model_validate(response.model_dump())


def stream_response(
    transport: OpenAICompatTransport, call: ResponsesCall
) -> Iterator[ResponsesStreamEvent]:
    """Yield semantic Responses-API stream events."""
    stream = transport.sdk.responses.create(**_build_kwargs(transport, call, stream=True))
    for event in stream:
        yield ResponsesStreamEvent.model_validate(event.model_dump())
