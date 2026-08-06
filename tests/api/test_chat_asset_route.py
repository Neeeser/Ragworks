"""HTTP contract for the chat-session asset route.

Attachment records travel to the client on message rows; this route is how
the transcript fetches the bytes. The contract worth pinning is the
authorization boundary: the path must resolve inside the requested
session's own directory, and the session must belong to the caller.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.utils.file_storage import FileStorage

PNG_BYTES = b"\x89PNG\r\n\x1a\n-chat-bytes"


@pytest.fixture(name="chat_session")
def chat_session_fixture(session: Session, auth_user: models.User) -> models.ChatSession:
    chat_session = models.ChatSession(user_id=auth_user.id, title="Assets", chat_model="m")
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    return chat_session


def _store(session_id: UUID) -> str:
    relative = f"chat/{session_id}/a.png"
    FileStorage().write_bytes(PNG_BYTES, relative)
    return relative


def test_an_attachment_streams_with_its_media_type(
    client: TestClient, chat_session: models.ChatSession
) -> None:
    relative = _store(chat_session.id)

    response = client.get(f"/api/chat/sessions/{chat_session.id}/assets/{relative}")

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"] == "image/png"


def test_another_users_session_is_not_served(
    client: TestClient, session: Session, chat_session: models.ChatSession
) -> None:
    """A session the caller does not own answers 404, asset or not."""
    other_user = models.User(email="other@example.com", hashed_password="hashed")
    session.add(other_user)
    session.commit()
    session.refresh(other_user)
    other_session = models.ChatSession(user_id=other_user.id, title="Theirs", chat_model="m")
    session.add(other_session)
    session.commit()
    session.refresh(other_session)
    relative = _store(other_session.id)

    response = client.get(f"/api/chat/sessions/{other_session.id}/assets/{relative}")

    assert response.status_code == 404


def test_a_path_into_another_session_is_not_served(
    client: TestClient, session: Session, chat_session: models.ChatSession, auth_user: models.User
) -> None:
    """Owning one session never reads another's directory, even via `..`."""
    sibling = models.ChatSession(user_id=auth_user.id, title="Sibling", chat_model="m")
    session.add(sibling)
    session.commit()
    session.refresh(sibling)
    _store(sibling.id)

    direct = client.get(f"/api/chat/sessions/{chat_session.id}/assets/chat/{sibling.id}/a.png")
    traversal = client.get(
        f"/api/chat/sessions/{chat_session.id}/assets/chat/{chat_session.id}/%2e%2e/{sibling.id}/a.png"
    )

    assert direct.status_code == 404
    assert traversal.status_code == 404


def test_the_route_requires_auth(unauthed_client: TestClient) -> None:
    response = unauthed_client.get(f"/api/chat/sessions/{uuid4()}/assets/chat/{uuid4()}/a.png")

    assert response.status_code == 401


def test_deleting_a_session_purges_its_stored_assets(
    client: TestClient, chat_session: models.ChatSession
) -> None:
    """DELETE on a session removes its attachment bytes, not only its rows.

    The route is the one deletion boundary for session-owned files; a
    delete that skips the purge leaves every deleted session's images on
    disk forever.
    """
    relative = _store(chat_session.id)

    response = client.delete(f"/api/chat/sessions/{chat_session.id}")

    assert response.status_code == 204
    with pytest.raises(FileNotFoundError):
        FileStorage().read_bytes(relative)
