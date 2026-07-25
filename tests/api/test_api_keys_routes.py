"""HTTP contract for API key management.

Scoping rules live at the service layer (`tests/services/test_api_keys.py`);
these pin the wire contract: the secret appears exactly once, a listing can
never carry it, and management requires a signed-in session rather than a key.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient


def _create_collection(client: TestClient) -> str:
    response = client.post("/api/collections", json={"name": "Keyed", "description": ""})
    assert response.status_code in (200, 201)
    return str(response.json()["id"])


def test_create_returns_the_secret_once_and_the_listing_never_does(
    client: TestClient,
) -> None:
    collection_id = _create_collection(client)

    created = client.post(
        "/api/api-keys",
        json={
            "name": "agent harness",
            "capabilities": ["tools:invoke", "files:read"],
            "collection_ids": [collection_id],
        },
    )

    assert created.status_code == 201
    body = created.json()
    secret = body["secret"]
    assert secret.startswith("rw_")
    assert body["key"]["capabilities"] == ["tools:invoke", "files:read"]
    assert body["key"]["collection_ids"] == [collection_id]

    listing = client.get("/api/api-keys")
    assert listing.status_code == 200
    assert secret not in listing.text
    keys = listing.json()["keys"]
    assert len(keys) == 1
    assert "secret" not in keys[0]
    assert keys[0]["prefix"] in secret
    assert keys[0]["last_used_at"] is None


def test_create_rejects_an_empty_capability_list(client: TestClient) -> None:
    collection_id = _create_collection(client)

    response = client.post(
        "/api/api-keys",
        json={"name": "no powers", "capabilities": [], "collection_ids": [collection_id]},
    )

    assert response.status_code == 422


def test_create_rejects_an_unknown_capability(client: TestClient) -> None:
    collection_id = _create_collection(client)

    response = client.post(
        "/api/api-keys",
        json={
            "name": "invented",
            "capabilities": ["collections:destroy"],
            "collection_ids": [collection_id],
        },
    )

    assert response.status_code == 422


def test_create_without_a_collection_scope_is_a_422(client: TestClient) -> None:
    """A scopeless key is unrepresentable, so it fails validation, not the service."""
    for body in (
        {"name": "scopeless", "capabilities": ["tools:invoke"]},
        {"name": "scopeless", "capabilities": ["tools:invoke"], "collection_ids": []},
    ):
        response = client.post("/api/api-keys", json=body)

        assert response.status_code == 422


def test_revoke_marks_the_key_revoked_and_keeps_the_record(client: TestClient) -> None:
    collection_id = _create_collection(client)
    created = client.post(
        "/api/api-keys",
        json={
            "name": "temporary",
            "capabilities": ["tools:invoke"],
            "collection_ids": [collection_id],
        },
    ).json()

    response = client.delete(f"/api/api-keys/{created['key']['id']}")

    assert response.status_code == 204
    keys = client.get("/api/api-keys").json()["keys"]
    assert len(keys) == 1
    assert keys[0]["revoked_at"] is not None


def test_revoking_an_unknown_key_is_404(client: TestClient) -> None:
    assert client.delete(f"/api/api-keys/{uuid4()}").status_code == 404


def test_management_requires_a_session(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/api-keys").status_code == 401
    assert unauthed_client.post("/api/api-keys", json={}).status_code == 401
