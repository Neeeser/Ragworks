"""HTTP contract for the model shortlist endpoints."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient


def _connection_id(client: TestClient) -> str:
    return str(client.get("/api/connections").json()[0]["id"])


def test_shortlist_round_trips_a_pin(client: TestClient) -> None:
    connection_id = _connection_id(client)
    body = {
        "kind": "chat",
        "connection_id": connection_id,
        "model_id": "anthropic/claude-sonnet-5",
    }

    pinned = client.put("/api/models/shortlist/pins", json=body)
    assert pinned.status_code == 200
    assert pinned.json()["entry_type"] == "pinned"

    listed = client.get("/api/models/shortlist?kind=chat").json()
    assert [entry["model_id"] for entry in listed["pinned"]] == [
        "anthropic/claude-sonnet-5"
    ]
    assert listed["recent"] == []

    removed = client.request("DELETE", "/api/models/shortlist/pins", json=body)
    assert removed.status_code == 204
    assert client.get("/api/models/shortlist?kind=chat").json()["pinned"] == []


def test_recording_a_use_lands_in_recents(client: TestClient) -> None:
    body = {
        "kind": "embedding",
        "connection_id": _connection_id(client),
        "model_id": "openai/text-embedding-3-large",
    }

    recorded = client.post("/api/models/shortlist/recents", json=body)

    assert recorded.status_code == 200
    assert recorded.json()["last_used_at"] is not None
    listed = client.get("/api/models/shortlist?kind=embedding").json()
    assert [entry["model_id"] for entry in listed["recent"]] == [
        "openai/text-embedding-3-large"
    ]


def test_pinning_an_unknown_connection_is_404(client: TestClient) -> None:
    response = client.put(
        "/api/models/shortlist/pins",
        json={"kind": "chat", "connection_id": str(uuid4()), "model_id": "gpt-5"},
    )

    assert response.status_code == 404


def test_a_vector_store_kind_is_rejected(client: TestClient) -> None:
    response = client.put(
        "/api/models/shortlist/pins",
        json={
            "kind": "vector_store",
            "connection_id": _connection_id(client),
            "model_id": "gpt-5",
        },
    )

    assert response.status_code == 422


def test_shortlist_requires_authentication(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/models/shortlist?kind=chat").status_code == 401
