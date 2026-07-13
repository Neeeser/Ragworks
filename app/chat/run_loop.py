"""The single chat run loop, shared by streaming and non-streaming turns.

`run_chat` drives one chat turn to completion: it calls the provider, aggregates
usage, executes any requested tool calls (draining `ToolExecutor.execute`), and
finalizes the assistant response — looping until the model stops requesting
tools or `MAX_TOOL_ITERATIONS` is hit. The streaming and non-streaming variants
are the same loop parameterized by a single `stream` flag: the flag selects the
provider call (`chat_stream` vs `chat`), whether reasoning-derived tool calls
are combined with structured ones, and whether intermediate events are yielded
to the caller or drained. There is deliberately no second copy — two hand-synced
loops (and two copies of `MAX_TOOL_ITERATIONS`) were the bug this module retires.
"""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from typing import Any, Literal, overload

from sqlmodel import Session

from app.chat.events import FinalEvent
from app.chat.messages import AssistantMessage, ToolCall, normalize_assistant_content
from app.chat.persistence import (
    MessageRecord,
    RecordContext,
    convert_messages,
    convert_session,
    provider_message_from_model,
    record_message,
    record_partial_assistant_message,
    record_tool_call_assistant_message,
    serialize_messages,
)
from app.chat.reasoning import normalize_reasoning_segments
from app.chat.state import (
    ChatSetup,
    RunState,
    ToolCallResolution,
    ToolExecutionContext,
)
from app.chat.streaming import StreamOutcome, StreamState, stream_model_completion
from app.chat.tool_calls import extract_reasoning_tool_calls, normalize_tool_calls
from app.chat.tools import ToolExecutor
from app.chat.usage import UsageSummary, coerce_usage_value
from app.db import models
from app.db.repositories import ChatRepository
from app.providers.chat.base import ChatProvider, ChatRequest
from app.schemas.chat import ChatCompletionResponse, ChatMessageCreate
from app.telemetry import record
from app.telemetry.events import ChatTurnCompleted

MAX_TOOL_ITERATIONS = 48


@dataclass
class ChatRun:
    """The collaborators and mutable state for one chat turn."""

    provider: ChatProvider
    setup: ChatSetup
    run_state: RunState
    user: models.User
    payload: ChatMessageCreate
    session: Session
    chat_repo: ChatRepository
    tool_executor: ToolExecutor


@dataclass
class _RunResult:
    """Carries the finalized response out of the shared generator body."""

    response: ChatCompletionResponse | None = None


def update_usage_aggregate(run_state: RunState, usage: dict[str, Any]) -> None:
    """Fold a provider usage payload into the running aggregate."""
    if not usage:
        return
    run_state.latest_usage_payload = usage
    run_state.usage_aggregate = run_state.usage_aggregate.merged_with(UsageSummary.from_raw(usage))


def resolve_tool_calls(
    *,
    message: dict[str, Any],
    run_state: RunState,
    combine_reasoning: bool,
) -> ToolCallResolution:
    """Normalize the iteration's structured and reasoning-derived tool calls.

    `combine_reasoning` (true only when streaming) appends reasoning-derived
    calls to structured ones; otherwise structured calls win and reasoning calls
    are a fallback. Non-tool reasoning is accumulated onto the run's trace.
    """
    reasoning_content = message.get("reasoning") or message.get("reasoning_content")
    reasoning_segments = normalize_reasoning_segments(reasoning_content)
    base_tool_calls = normalize_tool_calls(
        message.get("tool_calls") or [],
        run_state.processed_reasoning_calls,
    )
    reasoning_tool_calls, reasoning_context, residual_reasoning = extract_reasoning_tool_calls(
        reasoning_segments,
        run_state.processed_reasoning_calls,
    )
    if combine_reasoning:
        pending_tool_calls = base_tool_calls + reasoning_tool_calls
    else:
        pending_tool_calls = base_tool_calls or reasoning_tool_calls
    shared_tool_reasoning: dict[str, Any] | None = None
    if pending_tool_calls:
        if reasoning_context:
            run_state.reasoning_call_segments.update(reasoning_context)
        elif reasoning_segments:
            shared_tool_reasoning = {"segments": reasoning_segments}
    elif reasoning_segments:
        run_state.reasoning_trace.extend(residual_reasoning or reasoning_segments)
    return ToolCallResolution(
        pending_tool_calls=pending_tool_calls,
        shared_tool_reasoning=shared_tool_reasoning,
    )


def append_tool_call_assistant_message(
    run: ChatRun,
    *,
    assistant_content: str | None,
    tool_calls: list[ToolCall],
) -> None:
    """Append the assistant tool-call message to history and persist it.

    The message history keeps a typed `AssistantMessage` (serialized to the wire
    shape only at the request boundary). The persisted `tool_payload` column
    genuinely needs plain dicts, and `model_dump()` reproduces the OpenAI wire
    shape byte-for-byte.
    """
    run.setup.messages.append(
        AssistantMessage(content=assistant_content or "", tool_calls=list(tool_calls))
    )
    tool_call_payloads = [call.model_dump() for call in tool_calls]
    record_tool_call_assistant_message(
        context=RecordContext(session=run.session, chat_repo=run.chat_repo),
        session_model=run.setup.session_model,
        content=assistant_content or "",
        tool_calls=tool_call_payloads,
    )


def finalize_response(
    run: ChatRun,
    *,
    message: dict[str, Any],
    usage: dict[str, Any],
    response_model_name: str | None,
) -> ChatCompletionResponse:
    """Persist the final assistant message and build the API response.

    Usage precedence is preserved exactly: the per-turn `context_tokens` uses the
    latest reported total (latest payload, else this response, else the aggregate
    total), while the response `usage` starts from that same latest/this-response
    payload and is then overlaid with the non-empty aggregate.
    """
    content = normalize_assistant_content(message.get("content"))
    reasoning_payload: dict[str, Any] | None = None
    if run.run_state.reasoning_trace:
        reasoning_payload = {"segments": run.run_state.reasoning_trace}
    latest_usage_source = run.run_state.latest_usage_payload or usage or {}
    latest_usage_total = coerce_usage_value(latest_usage_source.get("total_tokens"))
    final_usage: dict[str, Any] = dict(run.run_state.latest_usage_payload or usage or {})
    if not run.run_state.usage_aggregate.is_empty():
        final_usage = dict(final_usage) if final_usage else {}
        final_usage.update(run.run_state.usage_aggregate.model_dump(exclude_none=True))
    assistant_msg = record_message(
        RecordContext(session=run.session, chat_repo=run.chat_repo),
        MessageRecord(
            session_id=run.setup.session_model.id,
            role=models.ChatRole.ASSISTANT,
            content=content,
            model=response_model_name,
            reasoning=reasoning_payload,
            usage=final_usage,
        ),
    )
    run.setup.messages.append(provider_message_from_model(assistant_msg))
    run.setup.session_model.context_tokens = (
        latest_usage_total
        if latest_usage_total is not None
        else run.run_state.usage_aggregate.total_tokens or 0
    )
    run.session.add(run.setup.session_model)
    run.session.commit()
    turn_usage = UsageSummary.from_raw(final_usage)
    record(
        ChatTurnCompleted(
            user_id=run.setup.session_model.user_id,
            session_id=run.setup.session_model.id,
            model=response_model_name,
            prompt_tokens=turn_usage.prompt_tokens,
            completion_tokens=turn_usage.completion_tokens,
            reasoning_tokens=turn_usage.reasoning_tokens,
            total_tokens=turn_usage.total_tokens,
            cost=turn_usage.cost,
        )
    )
    tool_collection_ids = [context.collection.id for context in run.setup.tool_collections]
    return ChatCompletionResponse(
        session=convert_session(
            run.setup.session_model,
            tool_collection_ids=tool_collection_ids,
        ),
        messages=convert_messages(chat_repo=run.chat_repo, session_id=run.setup.session_model.id),
        tool_traces=run.run_state.tool_traces,
        usage=final_usage,
        provider=run.run_state.provider,
        context_window=run.setup.model.context_window,
        context_consumed=run.setup.session_model.context_tokens,
    )


def _build_request(run: ChatRun) -> ChatRequest:
    """Build the provider request for the current message history (shared by both modes)."""
    return ChatRequest(
        messages=serialize_messages(run.setup.messages),
        tools=run.setup.tools or None,
        model=run.setup.model.active_model_name,
        parameters=run.setup.model.parameter_overrides or None,
        reasoning_options=run.setup.model.reasoning_options or None,
        provider_preferences=run.setup.model.provider_preferences,
    )


def _stream_iteration(
    run: ChatRun,
    state: StreamState,
) -> Generator[dict[str, Any], None, StreamOutcome]:
    """Stream one provider turn, capturing partial content into `state` and yielding events."""
    stream = stream_model_completion(provider=run.provider, request=_build_request(run))
    while True:
        try:
            event = next(stream)
        except StopIteration as stop:
            outcome: StreamOutcome = stop.value
            return outcome
        if isinstance(event, dict):
            event_type = event.get("type")
            if event_type == "token":
                token_text = event.get("content")
                if isinstance(token_text, str):
                    state.content_parts.append(token_text)
            elif event_type == "reasoning":
                segments = event.get("segments")
                if isinstance(segments, list):
                    state.reasoning_segments = segments
        yield event


def _record_partial(run: ChatRun, state: StreamState) -> None:
    """Persist whatever content streamed before an abort or mid-stream failure."""
    partial_content = "".join(state.content_parts)
    reasoning_segments = [
        dict(segment) for segment in state.reasoning_segments if isinstance(segment, dict)
    ]
    record_partial_assistant_message(
        context=RecordContext(session=run.session, chat_repo=run.chat_repo),
        session_model=run.setup.session_model,
        content=partial_content,
        reasoning_segments=reasoning_segments,
        model=run.setup.model.active_model_name,
    )


def _provider_turn(
    run: ChatRun,
    *,
    stream: bool,
) -> Generator[dict[str, Any], None, tuple[dict[str, Any], dict[str, Any], str | None]]:
    """Run one provider call and return (message, usage, response_model_name).

    Streaming yields token/reasoning events as they arrive and persists partial
    content if the stream is aborted or the provider fails mid-turn. Non-streaming
    yields nothing and blocks on the single response. Updates `run_state.provider`
    from the turn's reported provider in both modes.
    """
    if stream:
        state = StreamState(provider=run.provider.name)
        try:
            outcome = yield from _stream_iteration(run, state)
        # Persist partial content on client disconnect (GeneratorExit) AND on a
        # mid-stream provider failure, then re-raise so the route surfaces an
        # error event. Not swallowed — always re-raised.
        except (GeneratorExit, Exception):  # pylint: disable=broad-exception-caught
            _record_partial(run, state)
            raise
        run.run_state.provider = outcome.provider or run.run_state.provider
        return outcome.message, outcome.usage, outcome.response_model
    response_payload = run.provider.chat(_build_request(run))
    parsed = run.provider.parse_chat_response(response_payload)
    run.run_state.provider = parsed.provider or run.run_state.provider
    return parsed.message, parsed.usage, parsed.response_model


def _iterate(
    run: ChatRun,
    result: _RunResult,
    *,
    stream: bool,
) -> Generator[dict[str, Any], None, None]:
    """The one loop: provider call -> usage -> tool branch -> finalize, repeated."""
    for _ in range(MAX_TOOL_ITERATIONS):
        message, usage, response_model_name = yield from _provider_turn(run, stream=stream)
        if usage:
            update_usage_aggregate(run.run_state, usage)

        resolution = resolve_tool_calls(
            message=message,
            run_state=run.run_state,
            combine_reasoning=stream,
        )
        if resolution.pending_tool_calls:
            assistant_content = normalize_assistant_content(message.get("content"))
            append_tool_call_assistant_message(
                run,
                assistant_content=assistant_content,
                tool_calls=resolution.pending_tool_calls,
            )
            tool_context = ToolExecutionContext(
                user=run.user,
                payload=run.payload,
                session_model=run.setup.session_model,
                messages=run.setup.messages,
                run_state=run.run_state,
                shared_tool_reasoning=resolution.shared_tool_reasoning,
                tool_collection_map=run.setup.tool_collection_map,
            )
            yield from run.tool_executor.execute(
                tool_calls=resolution.pending_tool_calls,
                context=tool_context,
            )
            continue

        result.response = finalize_response(
            run,
            message=message,
            usage=usage,
            response_model_name=response_model_name,
        )
        return
    raise RuntimeError("LLM did not complete within the allowed tool iteration limit.")


def _run_stream(run: ChatRun) -> Generator[dict[str, Any], None, None]:
    """Forward the loop's events, then emit the final response as a `FinalEvent`."""
    result = _RunResult()
    yield from _iterate(run, result, stream=True)
    if result.response is not None:
        yield FinalEvent(payload=result.response.model_dump()).model_dump()


def _run_blocking(run: ChatRun) -> ChatCompletionResponse:
    """Drain the loop's (unused) tool events and return the final response."""
    result = _RunResult()
    for _ in _iterate(run, result, stream=False):
        pass
    assert result.response is not None  # _iterate returns only after setting it or raising
    return result.response


@overload
def run_chat(run: ChatRun, *, stream: Literal[True]) -> Generator[dict[str, Any], None, None]: ...


@overload
def run_chat(run: ChatRun, *, stream: Literal[False]) -> ChatCompletionResponse: ...


def run_chat(
    run: ChatRun,
    *,
    stream: bool,
) -> Generator[dict[str, Any], None, None] | ChatCompletionResponse:
    """Drive one chat turn; stream events when `stream`, else return the response."""
    if stream:
        return _run_stream(run)
    return _run_blocking(run)
