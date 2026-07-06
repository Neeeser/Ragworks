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
from app.chat.messages import ToolCall
from app.chat.persistence.records import (
    MessageRecord,
    RecordContext,
    ToolCallRecord,
    record_message,
)
from app.chat.processing.tool_calls import ParsedToolCall, ToolResultPayload, parse_tool_call
from app.chat.state import RunState, ToolExecutionContext
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageCreate, ToolCallTrace
from app.services.retrieval import RetrievalService


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
        retrieval: RetrievalService,
    ) -> None:
        """Store the collaborators the execution path persists and retrieves through."""
        self.session = session
        self.chat_repo = chat_repo
        self.retrieval = retrieval

    @staticmethod
    def specs(
        tool_collections: list[Any],
    ) -> tuple[list[dict[str, object]], dict[str, models.Collection]]:
        """Return tool schemas and the tool-name -> collection map for the request.

        Static because spec building is pure (it reads only the resolved tool
        collections); callers use it during request setup before an executor
        instance exists.
        """
        if not tool_collections:
            return [], {}
        tools: list[dict[str, object]] = []
        tool_map: dict[str, models.Collection] = {}
        for tool_context in tool_collections:
            tool_name = tool_context.tool_name
            tool_map[tool_name] = tool_context.collection
            tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": (
                            "Search the Pinecone namespace for the collection "
                            f"'{tool_context.collection.name}' to gather grounded context. "
                            "Always call this tool before answering questions about "
                            "documents in this collection."
                        ),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "Natural language search query.",
                                },
                                "top_k": {
                                    "type": "integer",
                                    "description": "How many chunks to retrieve (max 10).",
                                    "default": 5,
                                    "minimum": 1,
                                    "maximum": 10,
                                },
                            },
                            "required": ["query"],
                        },
                    },
                }
            )
        return tools, tool_map

    @staticmethod
    def select_collection(
        *,
        tool_name: str,
        tool_map: dict[str, models.Collection],
    ) -> models.Collection:
        """Return the collection a tool call targets, or raise for an unknown tool."""
        if tool_name in tool_map:
            return tool_map[tool_name]
        if tool_name == "pinecone_query" and len(tool_map) == 1:
            return next(iter(tool_map.values()))
        raise ValueError("Tool call does not match an enabled collection.")

    @staticmethod
    def parse_call(
        tool_call: ToolCall | dict[str, Any],
        payload: ChatMessageCreate,
    ) -> ParsedToolCall:
        """Parse a tool call into the fields needed to execute it.

        The typed `ToolCall` (what the run loop always sends, post-
        `normalize_tool_calls`) is the primary input; the dict arm is the
        lenient boundary for un-normalized provider shapes — it backfills a
        fallback id when the provider omitted one, since downstream
        persistence/events require an id.
        """
        raw = tool_call.model_dump() if isinstance(tool_call, ToolCall) else tool_call
        return parse_tool_call(
            raw,
            default_query=payload.content,
            use_fallback_id=True,
        )

    def execute(
        self,
        *,
        tool_calls: list[ToolCall] | list[dict[str, Any]],
        context: ToolExecutionContext,
    ) -> Iterator[dict[str, Any]]:
        """Execute tool calls, yielding tool-call/tool-result events and persisting each.

        Consumes the typed `ToolCall` models the run loop resolves (the dict form
        is tolerated only as the lenient escape for un-normalized shapes — see
        `parse_call`). Yields a `ToolCallEvent` before retrieval and a
        `ToolResultEvent` after, as serialized dicts. Streaming callers forward
        them; non-streaming callers drain without forwarding. Persistence (tool
        message row and `ToolCallTrace`) happens once here, in either mode.
        """
        for tool_call in tool_calls:
            parsed = self.parse_call(tool_call, context.payload)
            collection = self.select_collection(
                tool_name=parsed.name,
                tool_map=context.tool_collection_map,
            )
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
            retrieval_response = self.retrieval.query_collection(
                context.user,
                collection,
                parsed.query_text,
                top_k=parsed.top_k,
            )
            response_payload = jsonable_encoder(retrieval_response)
            tool_result = ToolResultPayload(
                collection_id=str(collection.id),
                collection_name=collection.name,
                arguments=parsed.arguments,
                response=response_payload,
            )
            tool_content = json.dumps(tool_result.model_dump())
            reasoning_payload = build_reasoning_payload(
                call_id=parsed.id,
                run_state=context.run_state,
                shared_tool_reasoning=context.shared_tool_reasoning,
            )
            yield ToolResultEvent(
                id=parsed.id,
                name=parsed.name,
                arguments=parsed.arguments,
                response=retrieval_response,
                reasoning=reasoning_payload,
                collection_id=str(collection.id),
                collection_name=collection.name,
            ).model_dump()
            context.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": parsed.id,
                    "content": tool_content,
                }
            )
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
                        payload=tool_result.model_dump(),
                    ),
                    reasoning=reasoning_payload,
                ),
            )
