"""Chat Completions calls against any OpenAI-compatible endpoint."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.clients.openai_compat.transport import OpenAICompatTransport
from app.schemas.chat_completions import ChatCompletionChunk, ChatCompletionResponse


@dataclass(frozen=True)
class ChatCall:
    """One chat-completions invocation.

    The optional knobs are grouped into an object rather than spread across a
    parameter list because both the streaming and non-streaming entry points
    take the identical set — two long signatures drift the moment one grows a
    parameter the other doesn't.
    """

    messages: list[dict[str, Any]]
    model: str
    tools: list[dict[str, Any]] | None = None
    tool_choice: dict[str, Any] | None = None
    parallel_tool_calls: bool | None = None
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = field(default=None)
    parameters: dict[str, Any] | None = None


def _build_kwargs(
    transport: OpenAICompatTransport, call: ChatCall, *, stream: bool
) -> dict[str, Any]:
    """Assemble the SDK kwargs shared by the streaming and buffered paths."""
    kwargs: dict[str, Any] = {"messages": call.messages, "model": call.model}
    if call.tools:
        kwargs["tools"] = call.tools
    if call.tool_choice:
        kwargs["tool_choice"] = call.tool_choice
    if call.parallel_tool_calls is not None:
        kwargs["parallel_tool_calls"] = call.parallel_tool_calls
    headers = transport.merge_headers(call.extra_headers)
    if headers:
        kwargs["extra_headers"] = headers
    if call.extra_body:
        kwargs["extra_body"] = call.extra_body
    if call.parameters:
        kwargs.update(
            {key: value for key, value in call.parameters.items() if value is not None}
        )
    if stream:
        kwargs["stream"] = True
        # Part of the Chat Completions spec, and without it OpenAI-compatible
        # servers emit no usage chunk at all — the turn's token accounting
        # silently reads zero. OpenRouter ignores it (its own `usage` block in
        # extra_body governs) and the self-hosted servers honor it.
        kwargs["stream_options"] = {"include_usage": True}
    return kwargs


def chat(transport: OpenAICompatTransport, call: ChatCall) -> ChatCompletionResponse:
    """Request a buffered chat completion."""
    response = transport.sdk.chat.completions.create(
        **_build_kwargs(transport, call, stream=False)
    )
    return ChatCompletionResponse.model_validate(response.model_dump())


def chat_stream(
    transport: OpenAICompatTransport, call: ChatCall
) -> Iterator[ChatCompletionChunk]:
    """Yield streaming chat-completion chunks."""
    stream = transport.sdk.chat.completions.create(
        **_build_kwargs(transport, call, stream=True)
    )
    for chunk in stream:
        yield ChatCompletionChunk.model_validate(chunk.model_dump())
