"""Behavior of ``FileSystemService``: tree ops, uploads, moves, backfill."""

from __future__ import annotations

import io

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.enums import DocumentStatus, FileNodeKind
from app.schemas.files import FileNodeUpdate
from app.services.errors import InvalidInputError, NotFoundError
from app.services.file_backfill import backfill_file_nodes
from app.services.files import FileSystemService, UploadSpec, validate_node_name


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="files@example.com",
        full_name="Files Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _upload(
    service: FileSystemService,
    user: models.User,
    collection: models.Collection,
    name: str = "doc.txt",
    content_type: str = "text/plain",
    parent_id=None,
    relative_path: str | None = None,
):
    return service.register_upload(
        user,
        collection,
        UploadSpec(
            filename=name,
            content_type=content_type,
            parent_id=parent_id,
            relative_path=relative_path,
        ),
        io.BytesIO(b"content"),
    )


def test_validate_node_name_rejects_separators_and_dots() -> None:
    for bad in ("", "  ", "a/b", ".", "..", "x" * 256):
        with pytest.raises(InvalidInputError):
            validate_node_name(bad)
    assert validate_node_name("  report.pdf ") == "report.pdf"


def test_folders_nest_and_reject_sibling_collisions(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    reports = service.create_folder(user, collection, name="reports", parent_id=None)
    q3 = service.create_folder(user, collection, name="q3", parent_id=reports.id)
    assert q3.parent_id == reports.id

    with pytest.raises(InvalidInputError, match="already exists"):
        service.create_folder(user, collection, name="reports", parent_id=None)

    tree = service.tree(collection)
    paths = {node.name: node.path for node in tree.nodes}
    assert paths["reports"] == "/reports"
    assert paths["q3"] == "/reports/q3"


def test_upload_eligible_type_creates_pending_document(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    result = _upload(service, user, collection)

    assert result.file.kind == FileNodeKind.FILE
    assert result.file.size_bytes == len(b"content")
    assert result.document is not None
    assert result.document.status == DocumentStatus.PENDING
    assert result.document.file_id == result.file.id
    assert result.document.source_path == result.file.storage_path


def test_upload_ineligible_type_is_stored_without_document(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    result = _upload(service, user, collection, name="tool.exe",
                     content_type="application/x-msdownload")

    assert result.document is None
    read = service.read_node(result.file)
    assert read.ingestion is None


def test_upload_relative_path_creates_intermediate_folders(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    result = _upload(service, user, collection, relative_path="drop/nested/doc.txt")

    assert [folder.name for folder in result.created_folders] == ["drop", "nested"]
    read = service.read_node(result.file)
    assert read.path == "/drop/nested/doc.txt"

    # A second file in the same dropped folder reuses the folders.
    second = _upload(service, user, collection, relative_path="drop/nested/other.txt")
    assert second.created_folders == []


def test_upload_name_collision_gets_numeric_suffix(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    first = _upload(service, user, collection)
    second = _upload(service, user, collection)
    third = _upload(service, user, collection)

    assert first.file.name == "doc.txt"
    assert second.file.name == "doc (1).txt"
    assert third.file.name == "doc (2).txt"


def test_move_and_rename_update_path_and_reject_cycles(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    outer = service.create_folder(user, collection, name="outer", parent_id=None)
    inner = service.create_folder(user, collection, name="inner", parent_id=outer.id)
    upload = _upload(service, user, collection)

    moved = service.update_node(upload.file, FileNodeUpdate(parent_id=inner.id))
    assert service.read_node(moved).path == "/outer/inner/doc.txt"

    renamed = service.update_node(moved, FileNodeUpdate(name="renamed.txt"))
    assert service.read_node(renamed).path == "/outer/inner/renamed.txt"
    # The mirrored ingestion-record name follows the rename.
    document = service.documents.get_for_file(renamed.id)
    assert document is not None
    assert document.name == "renamed.txt"

    with pytest.raises(InvalidInputError, match="into itself"):
        service.update_node(outer, FileNodeUpdate(parent_id=inner.id))

    # Moving back to root via an explicit null parent_id.
    back = service.update_node(renamed, FileNodeUpdate(parent_id=None))
    assert service.read_node(back).path == "/renamed.txt"


def test_move_rejects_destination_name_collision(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    folder = service.create_folder(user, collection, name="folder", parent_id=None)
    _upload(service, user, collection, parent_id=folder.id)
    rooted = _upload(service, user, collection)

    with pytest.raises(InvalidInputError, match="already exists"):
        service.update_node(rooted.file, FileNodeUpdate(parent_id=folder.id))


def test_resolve_path_walks_segments(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    result = _upload(service, user, collection, relative_path="a/b/doc.txt")

    assert service.resolve_path(collection, "a/b/doc.txt").id == result.file.id
    assert service.resolve_path(collection, "/a/b/").kind == FileNodeKind.FOLDER
    with pytest.raises(NotFoundError):
        service.resolve_path(collection, "a/missing.txt")
    with pytest.raises(NotFoundError):
        service.resolve_path(collection, "/")


def test_listing_returns_children_and_breadcrumb(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = FileSystemService(session)

    _upload(service, user, collection, relative_path="a/b/doc.txt")
    folder_b = service.resolve_path(collection, "a/b")

    listing = service.listing(collection, folder_b.id)
    assert [crumb.name for crumb in listing.breadcrumb] == ["a", "b"]
    assert [entry.name for entry in listing.entries] == ["doc.txt"]

    root = service.listing(collection, None)
    assert root.parent is None
    assert [entry.name for entry in root.entries] == ["a"]


def test_backfill_creates_root_nodes_for_legacy_documents(session: Session, tmp_path) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    legacy_file = tmp_path / "legacy.txt"
    legacy_file.write_text("legacy content")
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="legacy.txt",
        content_type="text/plain",
        status=DocumentStatus.READY,
        embedding_model="embed",
        source_path=str(legacy_file),
    )
    session.add(document)
    session.commit()

    backfill_file_nodes(session)
    backfill_file_nodes(session)  # idempotent: second run must not duplicate

    nodes = FileSystemService(session).tree(collection).nodes
    assert len(nodes) == 1
    node = nodes[0]
    assert node.name == "legacy.txt"
    assert node.parent_id is None
    assert node.size_bytes == len("legacy content")
    session.refresh(document)
    assert document.file_id == node.id
