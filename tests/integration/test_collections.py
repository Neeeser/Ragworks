from __future__ import annotations

import os
from uuid import uuid4

from fastapi.testclient import TestClient


def _register_additional_user(client: TestClient) -> dict[str, object]:
    email = f"isolated+{uuid4().hex[:8]}@transparentrag.io"
    password = f"AltPass!{uuid4().hex[:6]}"
    register_resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "full_name": "Isolated User"},
    )
    assert register_resp.status_code == 201, register_resp.text
    token_resp = client.post(
        "/api/auth/token",
        data={"username": email, "password": password, "grant_type": "password"},
    )
    assert token_resp.status_code == 200, token_resp.text
    token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    settings_resp = client.patch(
        "/api/auth/me",
        json={
            "openrouter_api_key": os.getenv("TEST_OPENROUTER_API_KEY"),
            "pinecone_api_key": os.getenv("TEST_PINECONE_API_KEY"),
        },
        headers=headers,
    )
    assert settings_resp.status_code == 200, settings_resp.text
    return {"headers": headers, "email": email}


def test_collection_listing_includes_primary(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
) -> None:
    response = client.get("/api/collections", headers=user_context["headers"])
    assert response.status_code == 200, response.text
    ids = [collection["id"] for collection in response.json()]
    assert primary_collection["id"] in ids


def test_collection_update_allows_metadata_changes(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
) -> None:
    update_payload = {
        "description": "Updated via pytest",
        "metadata": {"owner": "pytest"},
    }
    response = client.patch(
        f"/api/collections/{primary_collection['id']}",
        headers=user_context["headers"],
        json=update_payload,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["description"] == "Updated via pytest"
    assert data["metadata"]["owner"] == "pytest"


def test_user_isolation_blocks_foreign_collection_access(
    client: TestClient,
    primary_collection: dict[str, object],
) -> None:
    outsider = _register_additional_user(client)
    response = client.get(
        f"/api/collections/{primary_collection['id']}",
        headers=outsider["headers"],
    )
    assert response.status_code == 404


def test_collection_delete_endpoint_removes_resources(
    client: TestClient,
    user_context: dict[str, object],
    collection_factory,
    sample_text_path,
) -> None:
    collection = collection_factory()
    with sample_text_path.open("rb") as handle:
        upload_resp = client.post(
            f"/api/collections/{collection['id']}/documents",
            headers=user_context["headers"],
            files={"file": (sample_text_path.name, handle, "text/plain")},
        )
    assert upload_resp.status_code == 201, upload_resp.text

    delete_resp = client.delete(
        f"/api/collections/{collection['id']}",
        headers=user_context["headers"],
    )
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["status"] == "deleted"

    check_resp = client.get(
        f"/api/collections/{collection['id']}",
        headers=user_context["headers"],
    )
    assert check_resp.status_code == 404
