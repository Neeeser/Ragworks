"""Pipeline-driven tool schemas and argument handling in chat tool execution."""

from __future__ import annotations

import json

from sqlmodel import Session, select

from app.chat.messages import FunctionCall, ToolCall
from app.chat.state import RunState, ToolExecutionContext
from app.chat.tools import ToolExecutor
from app.services.tool_projection import build_parameter_schema
from app.db import models
from app.db.repositories import ChatRepository
from app.pipelines.variables import PipelineInputArgument, VariableType
from app.schemas.chat import ChatMessageCreate
from app.services.errors import InvalidQueryArgumentsError
from tests.chat.conftest import StubInvocationService, make_tool_context

TOP_K = PipelineInputArgument(
    name="top_k",
    type=VariableType.INTEGER,
    description="How many chunks to return.",
    default=5,
    minimum=1,
    maximum=20,
    expose_to_llm=True,
)
MODE = PipelineInputArgument(
    name="mode",
    type=VariableType.ENUM,
    choices=["fast", "deep"],
    required=True,
    expose_to_llm=True,
)
HIDDEN = PipelineInputArgument(
    name="boost",
    type=VariableType.NUMBER,
    default=1.0,
    expose_to_llm=False,
)


class TestBuildParameterSchema:
    """The tool parameter schema is generated from declared arguments."""

    def test_legacy_schema_unchanged_without_declarations(self) -> None:
        schema = build_parameter_schema(())
        assert schema == {
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
        }

    def test_declared_arguments_replace_builtin_top_k(self) -> None:
        schema = build_parameter_schema((TOP_K, MODE, HIDDEN))
        properties = schema["properties"]
        assert set(properties) == {"query", "top_k", "mode"}  # boost is hidden
        assert properties["top_k"] == {
            "type": "integer",
            "description": "How many chunks to return.",
            "default": 5,
            "minimum": 1,
            "maximum": 20,
        }
        assert properties["mode"] == {"type": "string", "enum": ["fast", "deep"]}
        assert schema["required"] == ["query", "mode"]

    def test_declaring_pipeline_without_exposed_arguments_gets_query_only(self) -> None:
        schema = build_parameter_schema((HIDDEN,))
        assert set(schema["properties"]) == {"query"}
        assert schema["required"] == ["query"]


def _execute(
    session: Session,
    chat_user: models.User,
    collection: models.Collection,
    *,
    query_arguments: tuple[PipelineInputArgument, ...],
    call_arguments: dict[str, object],
    retrieval: StubInvocationService | None = None,
) -> tuple[list[dict[str, object]], StubInvocationService]:
    chat_session = models.ChatSession(
        user_id=chat_user.id, title="Args", chat_model="tool-model"
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    retrieval = retrieval or StubInvocationService()
    executor = ToolExecutor(
        session=session,
        chat_repo=ChatRepository(session),
        invocation=retrieval,  # type: ignore[arg-type]
    )
    tool_context = make_tool_context(
        collection, tool_name="search_docs", query_arguments=query_arguments
    )
    context = ToolExecutionContext(
        user=chat_user,
        payload=ChatMessageCreate(content="hi", tool_collection_ids=[collection.id]),
        session_model=chat_session,
        messages=[],
        run_state=RunState(),
        shared_tool_reasoning=None,
        tool_collection_map={"search_docs": tool_context},
    )
    calls = [
        ToolCall(
            id="call-1",
            function=FunctionCall(name="search_docs", arguments=json.dumps(call_arguments)),
        )
    ]
    events = list(executor.execute(tool_calls=calls, context=context))
    return events, retrieval


def test_declared_arguments_flow_into_retrieval(
    session: Session, chat_user, make_collection
) -> None:
    collection = make_collection(chat_user)
    events, retrieval = _execute(
        session,
        chat_user,
        collection,
        query_arguments=(TOP_K,),
        call_arguments={"query": "docs", "top_k": 12},
    )
    # No explicit top_k on the declared-arguments path: the invocation
    # service owns the default; the declared argument carries the value.
    assert retrieval.calls == [
        {"query": "docs", "top_k": None, "arguments": {"top_k": 12}}
    ]
    result = next(event for event in events if event["type"] == "tool_result")
    assert result["error"] is None
    assert result["response"] is not None


def test_legacy_pipeline_keeps_clamped_top_k_path(
    session: Session, chat_user, make_collection
) -> None:
    collection = make_collection(chat_user)
    _, retrieval = _execute(
        session,
        chat_user,
        collection,
        query_arguments=(),
        call_arguments={"query": "docs", "top_k": 50},
    )
    # Legacy path: clamped to 10, passed positionally, no arguments map.
    assert retrieval.calls == [{"query": "docs", "top_k": 10, "arguments": None}]


class _RejectingRetrieval(StubInvocationService):
    """Raises the argument-violation error the real service raises."""

    def invoke_binding(self, *args: object, **kwargs: object):  # type: ignore[override]
        super().invoke_binding(*args, **kwargs)  # record the call
        raise InvalidQueryArgumentsError("Argument 'top_k': must be at most 20.")


def test_argument_violation_becomes_tool_error_not_turn_failure(
    session: Session, chat_user, make_collection
) -> None:
    """A declared-argument violation yields an error tool result the model
    can react to (and persists it as the tool message content) instead of
    raising out of the turn."""
    collection = make_collection(chat_user)
    events, _ = _execute(
        session,
        chat_user,
        collection,
        query_arguments=(TOP_K,),
        call_arguments={"query": "docs", "top_k": 999},
        retrieval=_RejectingRetrieval(),
    )
    result = next(event for event in events if event["type"] == "tool_result")
    assert result["response"] is None
    assert "must be at most 20" in result["error"]

    chat_session = session.exec(select(models.ChatSession)).one()
    messages = ChatRepository(session).list_messages(chat_session.id)
    tool_rows = [message for message in messages if message.role == models.ChatRole.TOOL]
    assert len(tool_rows) == 1
    payload = json.loads(tool_rows[0].content)
    assert payload["response"] == {
        "error": "Invalid tool arguments: Argument 'top_k': must be at most 20."
    }


def test_unknown_extra_argument_is_forwarded_for_validation(
    session: Session, chat_user, make_collection
) -> None:
    """Stray model-invented keys go to the service, whose validation answers."""
    collection = make_collection(chat_user)
    _, retrieval = _execute(
        session,
        chat_user,
        collection,
        query_arguments=(TOP_K,),
        call_arguments={"query": "docs", "made_up": True},
    )
    assert retrieval.calls[0]["arguments"] == {"made_up": True}
