"""The single tool-execution path for chat tool calls.

`ToolExecutor` owns everything about turning an assistant's requested tool
calls into executed retrievals: building the tool specs advertised to the
provider, parsing each raw call, selecting its collection, running retrieval,
and persisting the tool message + trace. It exposes exactly one execution
method, `execute`, an iterator that yields `ToolCallEvent`/`ToolResultEvent`
dicts. Streaming callers forward those events to the client; non-streaming
callers drain the iterator and ignore them. There is deliberately no second,
event-free execution path: a streaming and a non-streaming variant that share
persistence but differ only in whether they yield are one implementation with
a drain, not two hand-synced loops.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.chat.events import ToolCallEvent, ToolResultEvent
from app.chat.messages import ToolCall, ToolMessage
from app.chat.persistence import (
    MessageRecord,
    RecordContext,
    ToolCallRecord,
    record_message,
)
from app.chat.state import (
    RunState,
    ToolCollectionContext,
    ToolContext,
    ToolExecutionContext,
)
from app.chat.tool_calls import ParsedToolCall, ToolResultPayload, parse_tool_call
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageCreate, ToolCallTrace
from app.schemas.tools import ToolInvocationResponse
from app.services.errors import InvalidInputError, InvalidQueryArgumentsError
from app.services.tool_invocation import ToolInvocationService


def select_tool_reasoning(
    *,
    call_id: str | None,
    run_state: RunState,
    shared_tool_reasoning: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Return the reasoning entry to attach to a tool-call event (non-destructive)."""
    if call_id is not None:
        entry = run_state.reasoning_call_segments.get(call_id)
        if entry:
            return entry
    return shared_tool_reasoning


def build_reasoning_payload(
    *,
    call_id: str | None,
    run_state: RunState,
    shared_tool_reasoning: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Consume and normalize the reasoning payload for a tool result.

    Pops the call's reasoning segment off `run_state` (so it is attributed once),
    falling back to any shared reasoning, and wraps a bare segment in the
    ``{"segments": [...]}`` shape the persistence layer expects.
    """
    reasoning_segment = (
        run_state.reasoning_call_segments.pop(call_id, None) if call_id is not None else None
    )
    if reasoning_segment is None and shared_tool_reasoning:
        reasoning_segment = shared_tool_reasoning
    if not reasoning_segment:
        return None
    if "segments" not in reasoning_segment:
        return {"segments": [reasoning_segment]}
    return reasoning_segment


class ToolExecutor:
    """Build tool specs, parse tool calls, and run the single execution path."""

    def __init__(
        self,
        *,
        session: Session,
        chat_repo: ChatRepository,
        invocation: ToolInvocationService,
    ) -> None:
        """Store the collaborators the execution path persists and invokes through."""
        self.session = session
        self.chat_repo = chat_repo
        self.invocation = invocation

    @staticmethod
    def specs(
        tool_collections: list[ToolCollectionContext],
    ) -> tuple[list[dict[str, object]], dict[str, ToolContext]]:
        """Return tool schemas and the tool-name -> tool-context map for the request.

        Static because spec building is pure (it reads only the resolved tool
        contexts, whose names/descriptions/parameter schemas setup already
        projected); callers use it during request setup before an executor
        instance exists.
        """
        tools: list[dict[str, object]] = []
        tool_map: dict[str, ToolContext] = {}
        for collection_context in tool_collections:
            for tool_context in collection_context.tools:
                tool_map[tool_context.tool_name] = tool_context
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool_context.tool_name,
                            "description": tool_context.description,
                            "parameters": tool_context.parameters,
                        },
                    }
                )
        return tools, tool_map

    @staticmethod
    def select_context(
        *,
        tool_name: str,
        tool_map: dict[str, ToolContext],
    ) -> ToolContext:
        """Return the tool context a call targets, or raise for an unknown tool."""
        if tool_name in tool_map:
            return tool_map[tool_name]
        if tool_name == "pinecone_query" and len(tool_map) == 1:
            return next(iter(tool_map.values()))
        raise InvalidInputError("Tool call does not match an enabled collection.")

    @classmethod
    def validate_calls(
        cls,
        *,
        tool_calls: list[ToolCall],
        tool_map: dict[str, ToolContext],
    ) -> None:
        """Ensure every requested tool names one of this turn's tools."""
        for tool_call in tool_calls:
            cls.select_context(tool_name=tool_call.function.name, tool_map=tool_map)

    @staticmethod
    def parse_call(
        tool_call: ToolCall,
        payload: ChatMessageCreate,
    ) -> ParsedToolCall:
        """Parse a typed tool call into the fields needed to execute it.

        The run loop always hands `execute` typed `ToolCall`s (every id is
        already resolved by `normalize_tool_calls`); `use_fallback_id=True` is
        kept as a belt-and-braces guard since downstream persistence/events
        require an id.
        """
        return parse_tool_call(
            tool_call.model_dump(),
            default_query=payload.content,
            use_fallback_id=True,
        )

    def _run_tool(
        self,
        user: models.User,
        tool_context: ToolContext,
        parsed: ParsedToolCall,
    ) -> tuple[ToolInvocationResponse | None, str | None]:
        """Run one parsed call's tool binding, returning `(response, tool_error)`.

        Pipelines with declared arguments get the model's arguments validated
        against the declarations; a violation becomes a tool error the model
        can react to instead of failing the turn. Legacy pipelines keep the
        historical clamped `top_k` path byte for byte.
        """
        if not tool_context.query_arguments:
            return (
                self.invocation.invoke_binding(
                    user,
                    tool_context.collection,
                    tool_context.binding_id,
                    parsed.query_text,
                    top_k=parsed.top_k,
                ),
                None,
            )
        supplied = {
            key: value
            for key, value in parsed.arguments.items()
            if key not in ("query", "text")
        }
        try:
            return (
                self.invocation.invoke_binding(
                    user,
                    tool_context.collection,
                    tool_context.binding_id,
                    parsed.query_text,
                    arguments=supplied,
                ),
                None,
            )
        except InvalidQueryArgumentsError as exc:
            return None, f"Invalid tool arguments: {exc}"

    def execute(
        self,
        *,
        tool_calls: list[ToolCall],
        context: ToolExecutionContext,
    ) -> Iterator[dict[str, Any]]:
        """Execute tool calls, yielding tool-call/tool-result events and persisting each.

        Consumes the typed `ToolCall` models the run loop resolves. Yields a
        `ToolCallEvent` before retrieval and a `ToolResultEvent` after, as
        serialized dicts. Streaming callers forward them; non-streaming callers
        drain without forwarding. Persistence (tool message row and
        `ToolCallTrace`) happens once here, in either mode.
        """
        for tool_call in tool_calls:
            parsed = self.parse_call(tool_call, context.payload)
            tool_context = self.select_context(
                tool_name=parsed.name,
                tool_map=context.tool_collection_map,
            )
            collection = tool_context.collection
            reasoning_entry = select_tool_reasoning(
                call_id=parsed.id,
                run_state=context.run_state,
                shared_tool_reasoning=context.shared_tool_reasoning,
            )
            yield ToolCallEvent(
                id=parsed.id,
                name=parsed.name,
                arguments=parsed.arguments,
                reasoning=reasoning_entry,
                collection_id=str(collection.id),
                collection_name=collection.name,
            ).model_dump()
            tool_response, tool_error = self._run_tool(context.user, tool_context, parsed)
            response_payload: Any = (
                jsonable_encoder(tool_response)
                if tool_response is not None
                else {"error": tool_error}
            )
            tool_result = ToolResultPayload(
                collection_id=str(collection.id),
                collection_name=collection.name,
                arguments=parsed.arguments,
                response=response_payload,
            )
            tool_payload = tool_result.model_dump()
            tool_payload["model_tool_call"] = tool_call.model_dump()
            tool_content = json.dumps(tool_payload)
            reasoning_payload = build_reasoning_payload(
                call_id=parsed.id,
                run_state=context.run_state,
                shared_tool_reasoning=context.shared_tool_reasoning,
            )
            yield ToolResultEvent(
                id=parsed.id,
                name=parsed.name,
                arguments=parsed.arguments,
                response=tool_response,
                error=tool_error,
                reasoning=reasoning_payload,
                collection_id=str(collection.id),
                collection_name=collection.name,
            ).model_dump()
            context.messages.append(ToolMessage(tool_call_id=parsed.id, content=tool_content))
            context.run_state.tool_traces.append(
                ToolCallTrace(
                    id=parsed.id,
                    name=parsed.name,
                    arguments=parsed.arguments,
                    response=response_payload,
                    reasoning=reasoning_payload,
                    collection_id=collection.id,
                    collection_name=collection.name,
                )
            )
            record_message(
                RecordContext(session=self.session, chat_repo=self.chat_repo),
                MessageRecord(
                    session_id=context.session_model.id,
                    role=models.ChatRole.TOOL,
                    content=tool_content,
                    tool=ToolCallRecord(
                        name=parsed.name,
                        call_id=parsed.id,
                        payload=tool_payload,
                    ),
                    reasoning=reasoning_payload,
                ),
            )
