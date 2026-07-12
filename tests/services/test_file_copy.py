"""Behavior of ``FileCopyService``: duplicate bytes, re-ingest, tree rules."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.enums import DocumentStatus
from app.services.errors import InvalidInputError
from app.services.file_copy import FileCopyService
from app.services.files import FileSystemService, UploadSpec


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="copy@example.com",
        full_name="Copy Tester",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
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
    body: bytes = b"copied content",
):
    return service.register_upload(
        user,
        collection,
        UploadSpec(filename=name, content_type=content_type, parent_id=parent_id),
        io.BytesIO(body),
    )


def test_copy_file_duplicates_bytes_and_queues_reingestion(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    fs = FileSystemService(session)
    original = _upload(fs, user, collection).file
    folder = fs.create_folder(user, collection, name="dest", parent_id=None)

    result = FileCopyService(session).copy(
        user, collection, original, target_parent_id=folder.id
    )

    clone = result.root
    assert clone.id != original.id
    assert clone.parent_id == folder.id
    assert clone.name == "doc.txt"  # no sibling collision in the destination
    assert clone.storage_path != original.storage_path
    assert Path(clone.storage_path).read_bytes() == b"copied content"
    assert clone.size_bytes == original.size_bytes
    # The copy re-ingests through the normal pipeline path: a fresh pending
    # document tied to the clone, while the original's record is untouched.
    assert [doc.file_id for doc in result.documents] == [clone.id]
    assert result.documents[0].status == DocumentStatus.PENDING


def test_copy_into_same_folder_dedupes_the_name(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    fs = FileSystemService(session)
    original = _upload(fs, user, collection).file

    result = FileCopyService(session).copy(
        user, collection, original, target_parent_id=None
    )

    assert result.root.name == "doc (1).txt"


def test_copy_folder_clones_the_whole_subtree(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    fs = FileSystemService(session)
    src = fs.create_folder(user, collection, name="src", parent_id=None)
    nested = fs.create_folder(user, collection, name="nested", parent_id=src.id)
    _upload(fs, user, collection, name="a.txt", parent_id=src.id)
    _upload(fs, user, collection, name="b.txt", parent_id=nested.id)
    _upload(fs, user, collection, name="skip.exe",
            content_type="application/x-msdownload", parent_id=src.id)

    result = FileCopyService(session).copy(user, collection, src, target_parent_id=None)

    paths = {node.path for node in fs.tree(collection).nodes}
    assert {"/src (1)", "/src (1)/nested", "/src (1)/a.txt",
            "/src (1)/nested/b.txt", "/src (1)/skip.exe"} <= paths
    # Only ingestible files get pending documents; the .exe is bytes-only.
    assert sorted(doc.name for doc in result.documents) == ["a.txt", "b.txt"]


def test_copy_folder_into_its_own_subtree_is_rejected(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    fs = FileSystemService(session)
    src = fs.create_folder(user, collection, name="src", parent_id=None)
    nested = fs.create_folder(user, collection, name="nested", parent_id=src.id)

    with pytest.raises(InvalidInputError, match="copy a folder into itself"):
        FileCopyService(session).copy(user, collection, src, target_parent_id=nested.id)


def test_copy_file_with_missing_bytes_is_rejected(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    fs = FileSystemService(session)
    original = _upload(fs, user, collection).file
    Path(original.storage_path).unlink()

    with pytest.raises(InvalidInputError, match="no stored bytes"):
        FileCopyService(session).copy(user, collection, original, target_parent_id=None)
