from __future__ import annotations

from fastapi.testclient import TestClient


def test_chat_creates_session_and_messages(chat_session: dict[str, object]) -> None:
    session = chat_session["session"]
    assert session["id"], "chat session missing id"
    assert chat_session["messages"], "chat session missing messages"
    assert chat_session["messages"][-1]["role"] == "assistant"
    assert chat_session["usage"]


def test_chat_history_and_listing_reflect_session(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
    chat_session: dict[str, object],
) -> None:
    session_id = chat_session["session"]["id"]
    list_resp = client.get(
        f"/api/collections/{primary_collection['id']}/sessions",
        headers=user_context["headers"],
    )
    assert list_resp.status_code == 200, list_resp.text
    session_ids = [item["id"] for item in list_resp.json()]
    assert session_id in session_ids

    history_resp = client.get(
        f"/api/chat/sessions/{session_id}",
        headers=user_context["headers"],
    )
    assert history_resp.status_code == 200, history_resp.text
    assert len(history_resp.json()) >= len(chat_session["messages"])
