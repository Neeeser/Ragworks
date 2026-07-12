"""HTTP contract for the file-tree routes (auth, ownership, shapes)."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes import files as files_routes
from app.db import models
from app.db.repositories import UserRepository


@pytest.fixture(autouse=True)
def _no_background_ingestion(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep TestClient from running real ingestion after upload responses."""
    monkeypatch.setattr(files_routes, "run_document_ingestion", lambda document_id: None)


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _other_user(session: Session) -> models.User:
    user = models.User(
        email="intruder@example.com",
        full_name="Intruder",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def _upload(client: TestClient, collection_id: object, name: str = "doc.txt") -> dict:
    response = client.post(
        f"/api/collections/{collection_id}/files",
        files={"file": (name, b"hello world", "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_file_routes_require_auth(unauthed_client: TestClient) -> None:
    collection_id = uuid4()
    assert unauthed_client.get(f"/api/collections/{collection_id}/files/tree").status_code == 401
    assert unauthed_client.get(f"/api/collections/{collection_id}/files").status_code == 401
    assert unauthed_client.patch(f"/api/files/{uuid4()}", json={}).status_code == 401
    assert unauthed_client.post(f"/api/files/{uuid4()}/copy", json={}).status_code == 401
    assert unauthed_client.delete(f"/api/files/{uuid4()}").status_code == 401
    assert unauthed_client.get(f"/api/files/{uuid4()}/content").status_code == 401


def test_upload_then_tree_lists_the_file_with_pending_ingestion(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    uploaded = _upload(client, collection.id)

    assert uploaded["file"]["path"] == "/doc.txt"
    assert uploaded["file"]["ingestion"]["status"] == "pending"

    tree = client.get(f"/api/collections/{collection.id}/files/tree")
    assert tree.status_code == 200
    body = tree.json()
    assert body["collection_id"] == str(collection.id)
    assert [node["name"] for node in body["nodes"]] == ["doc.txt"]


def test_folder_create_listing_and_breadcrumb(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    created = client.post(
        f"/api/collections/{collection.id}/folders",
        json={"name": "reports"},
    )
    assert created.status_code == 201
    folder_id = created.json()["id"]

    listing = client.get(
        f"/api/collections/{collection.id}/files", params={"parent_id": folder_id}
    )
    assert listing.status_code == 200
    body = listing.json()
    assert body["parent"]["name"] == "reports"
    assert [crumb["name"] for crumb in body["breadcrumb"]] == ["reports"]
    assert body["entries"] == []

    duplicate = client.post(
        f"/api/collections/{collection.id}/folders",
        json={"name": "reports"},
    )
    assert duplicate.status_code == 400


def test_folder_create_rejects_malformed_body(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    response = client.post(f"/api/collections/{collection.id}/folders", json={"name": ""})
    assert response.status_code == 422


def test_cross_user_access_is_a_404(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """Ownership isolation: another user's nodes look nonexistent."""
    intruder = _other_user(session)
    foreign_collection = _create_collection(session, intruder)
    foreign_node = models.FileNode(
        collection_id=foreign_collection.id,
        user_id=intruder.id,
        kind=models.FileNodeKind.FILE,
        name="secret.txt",
        content_type="text/plain",
    )
    session.add(foreign_node)
    session.commit()

    assert (
        client.get(f"/api/collections/{foreign_collection.id}/files/tree").status_code == 404
    )
    assert client.patch(
        f"/api/files/{foreign_node.id}", json={"name": "stolen.txt"}
    ).status_code == 404
    assert client.delete(f"/api/files/{foreign_node.id}").status_code == 404
    assert client.get(f"/api/files/{foreign_node.id}/content").status_code == 404
    assert client.post(f"/api/files/{foreign_node.id}/ingest").status_code == 404


def test_content_endpoint_streams_bytes_with_nosniff(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    uploaded = _upload(client, collection.id)
    file_id = uploaded["file"]["id"]

    inline = client.get(f"/api/files/{file_id}/content")
    assert inline.status_code == 200
    assert inline.content == b"hello world"
    assert inline.headers["x-content-type-options"] == "nosniff"
    assert inline.headers["content-disposition"].startswith("inline")

    attachment = client.get(
        f"/api/files/{file_id}/content", params={"disposition": "attachment"}
    )
    assert attachment.headers["content-disposition"].startswith("attachment")

    bad = client.get(f"/api/files/{file_id}/content", params={"disposition": "evil"})
    assert bad.status_code == 422


def test_rename_move_delete_roundtrip(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    folder = client.post(
        f"/api/collections/{collection.id}/folders", json={"name": "dest"}
    ).json()
    uploaded = _upload(client, collection.id)
    file_id = uploaded["file"]["id"]

    moved = client.patch(
        f"/api/files/{file_id}",
        json={"name": "renamed.txt", "parent_id": folder["id"]},
    )
    assert moved.status_code == 200
    assert moved.json()["path"] == "/dest/renamed.txt"

    deleted = client.delete(f"/api/files/{folder['id']}")
    assert deleted.status_code == 204
    tree = client.get(f"/api/collections/{collection.id}/files/tree").json()
    assert tree["nodes"] == []


def test_ingest_endpoint_queues_and_returns_pending(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    uploaded = _upload(client, collection.id, name="tool.xyz")
    # An ineligible upload has no ingestion record until manually queued.
    node = uploaded["file"]

    response = client.post(f"/api/files/{node['id']}/ingest")
    assert response.status_code == 202
    assert response.json()["ingestion"]["status"] == "pending"


def test_search_rejects_unknown_modes(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    response = client.get(
        f"/api/collections/{collection.id}/files/search",
        params={"q": "x", "modes": "name,bogus"},
    )
    assert response.status_code == 400


def test_copy_endpoint_creates_a_deduped_pending_copy(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    uploaded = _upload(client, collection.id)

    response = client.post(f"/api/files/{uploaded['file']['id']}/copy", json={})
    assert response.status_code == 201, response.text
    copy = response.json()
    assert copy["id"] != uploaded["file"]["id"]
    assert copy["name"] == "doc (1).txt"
    assert copy["path"] == "/doc (1).txt"
    assert copy["ingestion"]["status"] == "pending"


def test_copy_endpoint_is_ownership_isolated(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    intruder = _other_user(session)
    foreign_collection = _create_collection(session, intruder)
    foreign_node = models.FileNode(
        collection_id=foreign_collection.id,
        user_id=intruder.id,
        kind=models.FileNodeKind.FILE,
        name="secret.txt",
        content_type="text/plain",
    )
    session.add(foreign_node)
    session.commit()

    assert client.post(f"/api/files/{foreign_node.id}/copy", json={}).status_code == 404
