from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from app.db import models
from app.chat.persistence import records as records_module
from app.chat.persistence.records import (
    RecordContext,
    record_partial_assistant_message,
    record_tool_call_assistant_message,
    serialize_message,
)


def test_serialize_message_for_tool_role() -> None:
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.TOOL,
        content="tool-response",
        tool_call_id="call-1",
    )
    serialized = serialize_message(message)

    assert serialized["role"] == "tool"
    assert serialized["tool_call_id"] == "call-1"


def test_serialize_message_includes_tool_calls_for_assistant() -> None:
    message = models.ChatMessage(
        session_id=uuid4(),
        role=models.ChatRole.ASSISTANT,
        content="assistant",
        tool_payload={"tool_calls": [{"id": "call-1"}]},
    )
    serialized = serialize_message(message)

    assert serialized["tool_calls"][0]["id"] == "call-1"


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
    session = SimpleNamespace(add=lambda *args, **kwargs: None, flush=lambda: None, commit=lambda: None)
    monkeypatch.setattr(records_module, "record_message", record_message)

    record_partial_assistant_message(
        context=RecordContext(session=session, chat_repo=SimpleNamespace()),
        session_model=session_model,
        content="",
        reasoning_segments=[{"type": "text", "content": "thinking"}],
        model=None,
    )

    record_message.assert_called_once()
