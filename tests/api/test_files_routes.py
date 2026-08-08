"""HTTP contract for the file-tree routes (auth, ownership, shapes)."""

from __future__ import annotations

from urllib.parse import quote
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes import files as files_routes
from app.db import models
from app.db.repositories import UserRepository


@pytest.fixture(autouse=True)
def _no_background_ingestion(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep TestClient from running real ingestion after upload responses."""
    monkeypatch.setattr(files_routes, "enqueue_document_ingestion", lambda document_id: None)


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


def test_content_endpoint_serves_a_filename_outside_latin_1(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """A macOS screenshot name carries U+202F, which no latin-1 header can hold."""
    collection = _create_collection(session, auth_user)
    name = "Screenshot 2026-08-07 at 9.41.02\u202fAM.png"
    uploaded = _upload(client, collection.id, name=name)
    file_id = uploaded["file"]["id"]

    response = client.get(f"/api/files/{file_id}/content")

    assert response.status_code == 200
    assert response.content == b"hello world"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("inline")
    assert "filename*=utf-8''" in disposition
    assert quote(name) in disposition


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


def _seed_ready_document_from_run(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    run_version: int,
    pipeline_version: int,
) -> models.Document:
    """A ready document whose run recorded `run_version` of a bound pipeline."""
    pipeline = models.Pipeline(
        user_id=user.id, name="Ingest", current_version=pipeline_version
    )
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.INGEST,
        )
    )
    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version=run_version,
        trigger=models.BindingRole.INGEST,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    node = models.FileNode(
        collection_id=collection.id,
        user_id=user.id,
        kind=models.FileNodeKind.FILE,
        name="doc.txt",
        content_type="text/plain",
    )
    session.add(node)
    session.commit()
    session.refresh(node)
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        file_id=node.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        embedding_model="",
        ingestion_run_id=run.id,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def test_listing_marks_documents_from_older_pipeline_versions_stale(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    _seed_ready_document_from_run(
        session, auth_user, collection, run_version=2, pipeline_version=3
    )
    listing = client.get(f"/api/collections/{collection.id}/files").json()
    assert [entry["ingestion"]["stale"] for entry in listing["entries"]] == [True]


def test_reingest_stale_requeues_only_outdated_documents(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _create_collection(session, auth_user)
    document = _seed_ready_document_from_run(
        session, auth_user, collection, run_version=1, pipeline_version=2
    )
    response = client.post(f"/api/collections/{collection.id}/files/reingest-stale")
    assert response.status_code == 202
    assert response.json() == {"queued": 1}
    session.expire_all()
    refreshed = session.get(models.Document, document.id)
    assert refreshed is not None
    assert refreshed.status == models.DocumentStatus.PENDING

    # A second call finds nothing stale (the pending row is no longer ready).
    assert client.post(
        f"/api/collections/{collection.id}/files/reingest-stale"
    ).json() == {"queued": 0}


def test_retry_failed_requeues_every_document_that_missed_the_index(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """One action clears a whole outage; an indexed file is left alone.

    Per-file retry answers for one bad document. A provider outage fails every
    upload in flight, and clearing that one X at a time is what this replaces.
    """
    collection = _create_collection(session, auth_user)
    for name, status_value, chunks in (
        ("indexed.txt", models.DocumentStatus.READY, 3),
        ("failed-a.txt", models.DocumentStatus.FAILED, 0),
        ("failed-b.txt", models.DocumentStatus.FAILED, 0),
        # Ready with nothing indexed is invisible to retrieval, so it counts as
        # a miss however the row reads.
        ("empty.txt", models.DocumentStatus.READY, 0),
    ):
        session.add(
            models.Document(
                user_id=auth_user.id,
                collection_id=collection.id,
                name=name,
                content_type="text/plain",
                embedding_model="stub-embedder",
                status=status_value,
                num_chunks=chunks,
            )
        )
    session.commit()

    response = client.post(f"/api/collections/{collection.id}/files/retry-failed")
    assert response.status_code == 202
    assert response.json() == {"queued": 3}

    # Ingestion itself is stubbed in this file; what the route owns is which
    # rows it selects and that it leaves them claimable — a worker only ever
    # moves a `pending` row, so a `failed` one handed to the queue is dropped.
    session.expire_all()
    by_name = {
        document.name: document
        for document in session.exec(
            select(models.Document).where(models.Document.collection_id == collection.id)
        ).all()
    }
    for name in ("failed-a.txt", "failed-b.txt", "empty.txt"):
        assert by_name[name].status == models.DocumentStatus.PENDING
        assert by_name[name].error_message is None
    assert by_name["indexed.txt"].status == models.DocumentStatus.READY
    assert by_name["indexed.txt"].num_chunks == 3


def test_retry_failed_is_owner_scoped(client: TestClient, session: Session) -> None:
    """Another user's collection reads as 404, not 403 or an empty success."""
    intruder = _other_user(session)
    foreign = _create_collection(session, intruder)
    assert (
        client.post(f"/api/collections/{foreign.id}/files/retry-failed").status_code == 404
    )


def test_reingest_stale_is_owner_scoped(
    client: TestClient, session: Session
) -> None:
    intruder = _other_user(session)
    foreign = _create_collection(session, intruder)
    response = client.post(f"/api/collections/{foreign.id}/files/reingest-stale")
    assert response.status_code == 404
