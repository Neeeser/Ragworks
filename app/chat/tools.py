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
from app.chat.state import RunState, ToolCollectionContext, ToolExecutionContext
from app.chat.tool_calls import ParsedToolCall, ToolResultPayload, parse_tool_call
from app.db import models
from app.db.repositories import ChatRepository
from app.pipelines.variables import PipelineInputArgument, VariableType
from app.schemas.chat import ChatMessageCreate, ToolCallTrace
from app.schemas.retrieval import CollectionQueryResponse
from app.services.errors import InvalidInputError, InvalidQueryArgumentsError
from app.services.retrieval import RetrievalService


def build_parameter_schema(
    arguments: tuple[PipelineInputArgument, ...],
) -> dict[str, object]:
    """Build a tool's JSON parameter schema from its pipeline's declared arguments.

    A pipeline declaring no arguments keeps the historical contract (`query`
    plus the built-in 1-10 `top_k`); a declaring pipeline publishes exactly
    its `expose_to_llm` arguments beside the always-required `query`.
    """
    properties: dict[str, object] = {
        "query": {
            "type": "string",
            "description": "Natural language search query.",
        }
    }
    required = ["query"]
    if not arguments:
        properties["top_k"] = {
            "type": "integer",
            "description": "How many chunks to retrieve (max 10).",
            "default": 5,
            "minimum": 1,
            "maximum": 10,
        }
        return {"type": "object", "properties": properties, "required": required}
    for argument in arguments:
        if not argument.expose_to_llm or argument.type is VariableType.MODEL:
            continue
        properties[argument.name] = _argument_property(argument)
        if argument.required:
            required.append(argument.name)
    return {"type": "object", "properties": properties, "required": required}


def _argument_property(argument: PipelineInputArgument) -> dict[str, object]:
    """Map one declared argument onto its JSON Schema property."""
    if argument.type is VariableType.ENUM:
        prop: dict[str, object] = {"type": "string", "enum": list(argument.choices)}
    else:
        prop = {"type": argument.type.value}
    if argument.description:
        prop["description"] = argument.description
    if argument.default is not None:
        prop["default"] = argument.default
    if argument.minimum is not None:
        prop["minimum"] = argument.minimum
    if argument.maximum is not None:
        prop["maximum"] = argument.maximum
    return prop


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
        tool_collections: list[ToolCollectionContext],
    ) -> tuple[list[dict[str, object]], dict[str, ToolCollectionContext]]:
        """Return tool schemas and the tool-name -> tool-context map for the request.

        Static because spec building is pure (it reads only the resolved tool
        collections); callers use it during request setup before an executor
        instance exists. Each tool's parameter schema comes from its
        pipeline's declared arguments (`build_parameter_schema`).
        """
        if not tool_collections:
            return [], {}
        tools: list[dict[str, object]] = []
        tool_map: dict[str, ToolCollectionContext] = {}
        for tool_context in tool_collections:
            tool_name = tool_context.tool_name
            collection = tool_context.collection
            tool_map[tool_name] = tool_context
            description_parts = [f"Search the document collection '{collection.name}'."]
            description = (collection.description or "").strip()
            if description:
                description_parts.append(description)
            description_parts.append(
                "Always call this tool before answering questions about documents in this collection."
            )
            tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": " ".join(description_parts),
                        "parameters": build_parameter_schema(tool_context.query_arguments),
                    },
                }
            )
        return tools, tool_map

    @staticmethod
    def select_context(
        *,
        tool_name: str,
        tool_map: dict[str, ToolCollectionContext],
    ) -> ToolCollectionContext:
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
        tool_map: dict[str, ToolCollectionContext],
    ) -> None:
        """Ensure every requested tool names one of this turn's collections."""
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

    def _run_retrieval(
        self,
        user: models.User,
        tool_context: ToolCollectionContext,
        parsed: ParsedToolCall,
    ) -> tuple[CollectionQueryResponse | None, str | None]:
        """Run retrieval for one parsed call, returning `(response, tool_error)`.

        Pipelines with declared arguments get the model's arguments validated
        against the declarations; a violation becomes a tool error the model
        can react to instead of failing the turn. Legacy pipelines keep the
        historical clamped `top_k` path byte for byte.
        """
        if not tool_context.query_arguments:
            return (
                self.retrieval.query_collection(
                    user,
                    tool_context.collection,
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
                self.retrieval.query_collection(
                    user,
                    tool_context.collection,
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
            retrieval_response, tool_error = self._run_retrieval(
                context.user, tool_context, parsed
            )
            response_payload: Any = (
                jsonable_encoder(retrieval_response)
                if retrieval_response is not None
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
                response=retrieval_response,
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
