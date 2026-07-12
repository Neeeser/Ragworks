"""Behavior of ``FileDeletionService``: the per-file/subtree purge cascade."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.db import models
from app.pipelines.settings import IndexTarget
from app.schemas.enums import DocumentStatus, IndexBackend
from app.services import file_deletion as deletion_module
from app.services.errors import ExternalServiceError
from app.services.file_deletion import FileDeletionService
from app.services.files import FileSystemService, UploadSpec


class _RecordingStore:
    """Captures per-document vector purges."""

    def __init__(self) -> None:
        self.deleted: list[tuple[str, str, str]] = []

    def delete_document_vectors(self, index: str, namespace: str, document_id: str) -> None:
        self.deleted.append((index, namespace, document_id))


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="delete@example.com",
        full_name="Delete Tester",
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


def _upload(service: FileSystemService, user, collection, relative_path: str):
    return service.register_upload(
        user,
        collection,
        UploadSpec(filename=None, content_type="text/plain", relative_path=relative_path),
        io.BytesIO(b"content"),
    )


def _mark_ready(session: Session, document: models.Document) -> None:
    document.status = DocumentStatus.READY
    document.num_chunks = 1
    session.add(
        models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=document.collection_id,
            chunk_index=0,
            text="chunk",
            embedding=[0.1],
            chunk_metadata={},
            embedding_model="embed",
        )
    )
    session.commit()


def test_folder_delete_purges_subtree_rows_bytes_and_vectors(
    monkeypatch: pytest.MonkeyPatch, session: Session
) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)

    kept = _upload(files, user, collection, "keep/keep.txt")
    doomed = _upload(files, user, collection, "folder/nested/doc.txt")
    assert doomed.document is not None
    _mark_ready(session, doomed.document)

    store = _RecordingStore()
    monkeypatch.setattr(deletion_module, "get_vector_store", lambda *_a, **_k: store)
    folder = files.resolve_path(collection, "folder")

    FileDeletionService(session).delete(user, collection, folder)

    remaining = {node.name for node in files.tree(collection).nodes}
    assert remaining == {"keep", "keep.txt"}
    assert session.exec(select(models.Document)).all() == [kept.document]
    assert session.exec(select(models.DocumentChunkRecord)).all() == []
    # The hybrid default pipeline purges the document from both of its
    # indexes: the dense semantic index and the BM25 sibling.
    assert [(entry[0], entry[2]) for entry in store.deleted] == [
        ("ragworks", str(doomed.document.id)),
        ("ragworks-bm25", str(doomed.document.id)),
    ]
    # Bytes are gone from storage too.
    assert doomed.file.storage_path is not None
    assert not Path(doomed.file.storage_path).exists()


def test_delete_without_ready_documents_skips_vector_backends(
    monkeypatch: pytest.MonkeyPatch, session: Session
) -> None:
    """A failed/never-ingested file must not demand backend prerequisites."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)
    upload = _upload(files, user, collection, "doc.txt")

    def _boom(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("vector store must not be constructed")

    monkeypatch.setattr(deletion_module, "get_vector_store", _boom)

    FileDeletionService(session).delete(user, collection, upload.file)

    assert files.tree(collection).nodes == []
    assert session.exec(select(models.Document)).all() == []


def test_pinecone_purge_failure_surfaces_as_external_error(
    monkeypatch: pytest.MonkeyPatch, session: Session
) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)
    upload = _upload(files, user, collection, "doc.txt")
    assert upload.document is not None
    _mark_ready(session, upload.document)

    class _FailingStore:
        def delete_document_vectors(self, *_args: object) -> None:
            raise RuntimeError("pinecone down")

    monkeypatch.setattr(deletion_module, "get_vector_store", lambda *_a, **_k: _FailingStore())

    class _Resolved:
        class settings:
            namespace = "ns"
            index_name = "idx"
            backend = IndexBackend.PINECONE
            index_targets = (
                IndexTarget(
                    backend=IndexBackend.PINECONE, index_name="idx", vector_type="dense"
                ),
            )

    monkeypatch.setattr(deletion_module, "resolve_ingestion_pipeline", lambda *_a: _Resolved())

    with pytest.raises(ExternalServiceError, match="pinecone down"):
        FileDeletionService(session).delete(user, collection, upload.file)
