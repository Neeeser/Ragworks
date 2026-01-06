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
        f"/api/chat/sessions?collection_ids={primary_collection['id']}",
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


def test_delete_chat_session_removes_history(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
    ingested_documents: list[dict[str, object]],
) -> None:
    payload = {
        "content": "Tell me about the TransparentRAG setup.",
        "title": "Disposable Chat",
        "tool_collection_ids": [primary_collection["id"]],
    }
    create_resp = client.post(
        "/api/chat",
        headers=user_context["headers"],
        json=payload,
    )
    assert create_resp.status_code == 200, create_resp.text
    session_id = create_resp.json()["session"]["id"]

    delete_resp = client.delete(
        f"/api/chat/sessions/{session_id}",
        headers=user_context["headers"],
    )
    assert delete_resp.status_code == 204, delete_resp.text

    list_resp = client.get(
        f"/api/chat/sessions?collection_ids={primary_collection['id']}",
        headers=user_context["headers"],
    )
    assert list_resp.status_code == 200, list_resp.text
    assert session_id not in [item["id"] for item in list_resp.json()]

    history_resp = client.get(
        f"/api/chat/sessions/{session_id}",
        headers=user_context["headers"],
    )
    assert history_resp.status_code == 404, history_resp.text
