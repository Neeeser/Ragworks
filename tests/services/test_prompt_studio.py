"""The studio test bench: streamed and buffered runs stay in agreement."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.providers.chat.base import ParsedChatResponse, ParsedStreamChunk
from app.schemas.prompts import (
    PromptTestRequest,
    PromptTestStartEvent,
    PromptTestTokenEvent,
)
from app.services.prompts import studio


class _StubProvider:
    """A chat provider that streams three deltas, or refuses to stream."""

    name = "stub"

    def __init__(self, *, streams: bool = True) -> None:
        self.streams = streams
        self.buffered_calls = 0

    def chat_stream(self, request: Any) -> list[dict[str, Any]]:
        if not self.streams:
            raise RuntimeError("streaming unavailable")
        return [{"delta": part} for part in ("Hel", "lo ", "there")]

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk:
        return ParsedStreamChunk(
            provider="stub",
            response_model="stub-model",
            finish_reason=None,
            delta_content=chunk["delta"],
            tool_calls=None,
            reasoning=None,
            usage=None,
        )

    def chat(self, request: Any) -> dict[str, Any]:
        self.buffered_calls += 1
        return {}

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        return ParsedChatResponse(
            message={"role": "assistant", "content": "Hello there"},
            usage={},
            provider="stub",
            response_model="stub-model",
        )


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    user = models.User(email="bench@example.com", full_name="Bench", hashed_password="h")
    UserRepository(session).add(user)
    session.commit()
    return user


def _payload() -> PromptTestRequest:
    return PromptTestRequest(
        body="Hello {{user.full_name}}",
        context="chat.base",
        connection_id=uuid4(),
        model_name="stub-model",
    )


def _use(monkeypatch: pytest.MonkeyPatch, provider: _StubProvider) -> None:
    monkeypatch.setattr(
        studio.ProviderResolver, "chat", lambda self, connection_id: provider
    )


def test_stream_emits_the_payload_before_the_answer(
    session: Session, user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, _StubProvider())
    events = list(studio.stream_test(session, user, _payload()))
    assert isinstance(events[0], PromptTestStartEvent)
    # The bench can show what it sent while the model is still answering.
    assert [message.role for message in events[0].messages] == ["system", "user"]
    deltas = [event.content for event in events[1:] if isinstance(event, PromptTestTokenEvent)]
    assert deltas == ["Hel", "lo ", "there"]


def test_buffered_run_matches_the_streamed_one(
    session: Session, user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, _StubProvider())
    result = studio.run_test(session, user, _payload())
    assert result.response_text == "Hello there"
    assert [message.role for message in result.messages] == ["system", "user"]
    assert result.structured_output is None


def test_falls_back_to_one_buffered_call_when_streaming_is_unavailable(
    session: Session, user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = _StubProvider(streams=False)
    _use(monkeypatch, provider)
    result = studio.run_test(session, user, _payload())
    assert result.response_text == "Hello there"
    assert provider.buffered_calls == 1
