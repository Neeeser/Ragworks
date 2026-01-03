from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.chat.persistence.sessions import SessionRequest, ensure_session
from app.schemas.chat import ChatMessageCreate


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
        collection=SimpleNamespace(id=collection_id),
        payload=payload,
        default_chat_model="model",
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
        collection=SimpleNamespace(id=uuid4()),
        payload=payload,
        default_chat_model="model",
    )

    created = ensure_session(request)

    assert created.id == session_id
    assert chat_repo.added is created
    assert session.commits == 1
