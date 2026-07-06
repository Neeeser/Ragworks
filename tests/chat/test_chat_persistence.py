from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from sqlmodel import Session

from app.chat import persistence as persistence_module
from app.chat.messages import AssistantMessage, SystemMessage, ToolMessage, UserMessage
from app.chat.persistence import (
    RecordContext,
    SessionPreferencesUpdate,
    SessionRequest,
    ensure_session,
    persist_base_prompt,
    persist_session_preferences,
    provider_message_from_model,
    record_partial_assistant_message,
    record_tool_call_assistant_message,
    serialize_messages,
)
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.chat import ChatMessageCreate

# --- Read boundary: persisted rows -> typed provider messages ---------------


def test_provider_message_from_model_tool_role() -> None:
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.TOOL,
        content="tool-response",
        tool_call_id="call-1",
    )

    result = provider_message_from_model(message)

    assert isinstance(result, ToolMessage)
    assert result.tool_call_id == "call-1"
    assert result.content == "tool-response"


def test_provider_message_from_model_user_and_system_roles() -> None:
    user = provider_message_from_model(
        models.ChatMessage(session_id=uuid4(), role=models.ChatRole.USER, content="hi")
    )
    system = provider_message_from_model(
        models.ChatMessage(session_id=uuid4(), role=models.ChatRole.SYSTEM, content="be nice")
    )

    assert isinstance(user, UserMessage)
    assert user.content == "hi"
    assert isinstance(system, SystemMessage)
    assert system.content == "be nice"


def test_provider_message_from_model_assistant_with_full_tool_calls() -> None:
    """A row written by the run loop round-trips its tool_calls exactly."""
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.ASSISTANT,
        content="calling",
        tool_payload={
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "pinecone_query", "arguments": '{"query": "docs"}'},
                }
            ]
        },
    )

    result = provider_message_from_model(message)

    assert isinstance(result, AssistantMessage)
    assert result.tool_calls is not None
    assert result.tool_calls[0].id == "call-1"
    assert result.tool_calls[0].function.name == "pinecone_query"
    assert result.tool_calls[0].function.arguments == '{"query": "docs"}'


def test_provider_message_from_model_normalizes_lenient_tool_calls() -> None:
    """Legacy on-disk tool_calls missing type/function are backfilled, not crashed."""
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.ASSISTANT,
        content="assistant",
        tool_payload={"tool_calls": [{"id": "call-1"}]},
    )

    result = provider_message_from_model(message)

    assert isinstance(result, AssistantMessage)
    assert result.tool_calls is not None
    call = result.tool_calls[0]
    assert call.id == "call-1"
    assert call.type == "function"
    assert call.function.name == ""
    assert call.function.arguments == "{}"


def test_provider_message_from_model_reads_top_level_tool_call_fields() -> None:
    """A tool_call entry carrying name/arguments at the top level is normalized."""
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.ASSISTANT,
        content="assistant",
        tool_payload={
            "tool_calls": [
                {"id": "call-2", "name": "pinecone_query", "arguments": {"query": "docs"}}
            ]
        },
    )

    result = provider_message_from_model(message)

    assert isinstance(result, AssistantMessage)
    call = result.tool_calls[0]
    assert call.function.name == "pinecone_query"
    assert call.function.arguments == '{"query": "docs"}'


def test_provider_message_from_model_drops_unusable_tool_call_entries() -> None:
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.ASSISTANT,
        content="assistant",
        tool_payload={"tool_calls": ["not-a-dict"]},
    )

    result = provider_message_from_model(message)

    assert isinstance(result, AssistantMessage)
    assert result.tool_calls is None


def test_provider_message_from_model_coerces_none_content() -> None:
    message = models.ChatMessage(session_id=uuid4(), role=models.ChatRole.ASSISTANT, content=None)

    result = provider_message_from_model(message)

    assert result.content == ""


def test_serialize_messages_renders_wire_dicts() -> None:
    messages = [
        SystemMessage(content="system"),
        UserMessage(content="hi"),
        provider_message_from_model(
            models.ChatMessage(
                session_id=uuid4(),
                role=models.ChatRole.ASSISTANT,
                content="calling",
                tool_payload={
                    "tool_calls": [
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {"name": "pinecone_query", "arguments": "{}"},
                        }
                    ]
                },
            )
        ),
        ToolMessage(tool_call_id="call-1", content="result"),
    ]

    dicts = serialize_messages(messages)

    assert dicts[0] == {"role": "system", "content": "system"}
    assert dicts[1] == {"role": "user", "content": "hi"}
    assert dicts[2]["role"] == "assistant"
    assert dicts[2]["tool_calls"][0]["function"]["name"] == "pinecone_query"
    assert dicts[3] == {"role": "tool", "tool_call_id": "call-1", "content": "result"}


def test_serialize_messages_omits_tool_calls_for_plain_assistant() -> None:
    dicts = serialize_messages([AssistantMessage(content="hello")])

    assert dicts == [{"role": "assistant", "content": "hello"}]


# --- Message writes ---------------------------------------------------------


def test_record_tool_call_assistant_message_skips_empty_calls() -> None:
    session_model = SimpleNamespace(id=uuid4(), updated_at=None)
    session = SimpleNamespace(
        add=Mock(side_effect=AssertionError("session.add should not be called")),
        flush=Mock(side_effect=AssertionError("session.flush should not be called")),
        commit=Mock(side_effect=AssertionError("session.commit should not be called")),
    )
    record_tool_call_assistant_message(
        context=RecordContext(session=session, chat_repo=SimpleNamespace()),
        session_model=session_model,
        content="",
        tool_calls=[],
    )


def test_record_partial_assistant_message_skips_empty_payload() -> None:
    session_model = SimpleNamespace(id=uuid4(), chat_model="model", updated_at=None)
    session = SimpleNamespace(
        add=Mock(side_effect=AssertionError("session.add should not be called")),
        flush=Mock(side_effect=AssertionError("session.flush should not be called")),
        commit=Mock(side_effect=AssertionError("session.commit should not be called")),
    )
    record_partial_assistant_message(
        context=RecordContext(session=session, chat_repo=SimpleNamespace()),
        session_model=session_model,
        content="  ",
        reasoning_segments=None,
        model=None,
    )


def test_record_partial_assistant_message_records_reasoning(monkeypatch) -> None:
    session_model = SimpleNamespace(id=uuid4(), chat_model="model", updated_at=None)
    record_message = Mock()
    session = SimpleNamespace(
        add=lambda *args, **kwargs: None, flush=lambda: None, commit=lambda: None
    )
    monkeypatch.setattr(persistence_module, "record_message", record_message)

    record_partial_assistant_message(
        context=RecordContext(session=session, chat_repo=SimpleNamespace()),
        session_model=session_model,
        content="",
        reasoning_segments=[{"type": "text", "content": "thinking"}],
        model=None,
    )

    record_message.assert_called_once()


# --- Session resolution -----------------------------------------------------


class _StubChatRepo:
    def __init__(self, existing=None) -> None:
        self.existing = existing
        self.added = None

    def get_session(self, *_args, **_kwargs):
        return self.existing

    def add_session(self, session_model) -> None:
        self.added = session_model


class _StubSession:
    def __init__(self) -> None:
        self.commits = 0

    def commit(self) -> None:
        self.commits += 1


def test_ensure_session_returns_existing_session() -> None:
    session_id = uuid4()
    collection_id = uuid4()
    existing = SimpleNamespace(id=session_id, collection_id=collection_id)
    chat_repo = _StubChatRepo(existing=existing)
    payload = ChatMessageCreate(content="Hello", session_id=session_id)

    request = SessionRequest(
        chat_repo=chat_repo,
        session=_StubSession(),
        user=SimpleNamespace(id=uuid4()),
        payload=payload,
        default_chat_model="model",
        primary_collection_id=collection_id,
    )

    resolved = ensure_session(request)

    assert resolved is existing
    assert chat_repo.added is None


def test_ensure_session_creates_session_with_requested_id() -> None:
    session_id = uuid4()
    chat_repo = _StubChatRepo(existing=None)
    session = _StubSession()
    payload = ChatMessageCreate(content="Hello", session_id=session_id, title="Session title")

    request = SessionRequest(
        chat_repo=chat_repo,
        session=session,
        user=SimpleNamespace(id=uuid4()),
        payload=payload,
        default_chat_model="model",
        primary_collection_id=uuid4(),
    )

    created = ensure_session(request)

    assert created.id == session_id
    assert chat_repo.added is created
    assert session.commits == 1


def test_ensure_session_prefers_user_last_used_model() -> None:
    chat_repo = _StubChatRepo(existing=None)
    session = _StubSession()
    user = SimpleNamespace(id=uuid4(), last_used_chat_model="last-used-model")
    payload = ChatMessageCreate(content="Hello")

    request = SessionRequest(
        chat_repo=chat_repo,
        session=session,
        user=user,
        payload=payload,
        default_chat_model="default-model",
        primary_collection_id=None,
    )

    created = ensure_session(request)

    assert created.chat_model == "last-used-model"


# --- Run-preference and account persistence ---------------------------------


def test_persist_session_preferences_updates_session_and_user(session: Session) -> None:
    user = models.User(email="user@example.com", full_name="User", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)

    chat_session = models.ChatSession(
        user_id=user.id,
        title="Session",
        mode=models.ChatMode.CHAT,
        chat_model="test-model",
        context_tokens=0,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)

    tool_id = uuid4()
    persist_session_preferences(
        session=session,
        session_model=chat_session,
        user=user,
        preferences=SessionPreferencesUpdate(
            parameter_overrides={"temperature": 0.2},
            provider_preferences={"order": ["alpha"]},
            stream_enabled=True,
            tool_collection_ids=[tool_id],
        ),
    )
    session.commit()
    session.refresh(chat_session)
    session.refresh(user)

    assert chat_session.parameter_overrides == {"temperature": 0.2}
    assert chat_session.provider_preferences == {"order": ["alpha"]}
    assert chat_session.stream is True
    assert user.last_used_chat_model == "test-model"
    assert user.last_used_parameters == {"temperature": 0.2}
    assert user.last_used_provider == {"order": ["alpha"]}
    assert user.last_used_stream is True
    assert user.last_used_tool_collection_ids == [str(tool_id)]


def test_persist_base_prompt_sets_and_clears_template(session: Session) -> None:
    repo = UserRepository(session)
    user = models.User(email="prompt@example.com", full_name="Prompt", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)

    persist_base_prompt(session=session, user=user, template="  Custom prompt  ")
    session.refresh(user)
    assert user.system_prompt_template == "Custom prompt"

    persist_base_prompt(session=session, user=user, template="   ")
    session.refresh(user)
    assert user.system_prompt_template is None
