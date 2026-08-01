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
from app.services.pipeline_resolution import PurgeTarget
from tests.utils.providers import install_default_pipelines


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
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
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

    purge_targets = [
        PurgeTarget(
            target=IndexTarget(
                backend=IndexBackend.PINECONE, index_name="idx", vector_type="dense"
            ),
            namespace="ns",
        )
    ]

    monkeypatch.setattr(
        deletion_module, "resolve_purge_targets", lambda *_a, **_k: purge_targets
    )

    with pytest.raises(ExternalServiceError, match="pinecone down"):
        FileDeletionService(session).delete(user, collection, upload.file)


def test_delete_purges_ingestion_events_and_insight_points(
    monkeypatch: pytest.MonkeyPatch, session: Session
) -> None:
    """Rows referencing the doomed documents must go too (regression:
    deleting an ingested file 500'd on the ingestion_events FK, and a file
    with stored insight points hits the insight_points FK the same way)."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)
    upload = _upload(files, user, collection, "doc.txt")
    assert upload.document is not None
    _mark_ready(session, upload.document)

    session.add(
        models.IngestionEvent(
            document_id=upload.document.id,
            collection_id=collection.id,
            event_type="ingestion",
            status="completed",
            details={},
        )
    )
    chunk = session.exec(select(models.DocumentChunkRecord)).one()
    snapshot = models.InsightSnapshotRecord(
        collection_id=collection.id,
        user_id=user.id,
        space=models.InsightSpace.SEMANTIC,
        space_label="embed",
        status=models.InsightStatus.READY,
        point_count=1,
        fitted_count=1,
    )
    session.add(snapshot)
    session.commit()
    session.add(
        models.InsightPointRecord(
            snapshot_id=snapshot.id,
            chunk_id=chunk.id,
            document_id=upload.document.id,
            chunk_index=0,
            x=0.1,
            y=0.2,
        )
    )
    session.commit()

    store = _RecordingStore()
    monkeypatch.setattr(deletion_module, "get_vector_store", lambda *_a, **_k: store)

    FileDeletionService(session).delete(user, collection, upload.file)

    assert session.exec(select(models.Document)).all() == []
    assert session.exec(select(models.IngestionEvent)).all() == []
    assert session.exec(select(models.InsightPointRecord)).all() == []
    # The purge books the removal as drift on the surviving snapshot.
    reloaded = session.get(models.InsightSnapshotRecord, snapshot.id)
    assert reloaded is not None
    assert reloaded.deleted_count == 1


def test_delete_wins_when_ingestion_commits_chunks_mid_purge(session: Session) -> None:
    """A file deleted while its ingestion is in flight is still deleted.

    The ingestion worker commits chunk rows from its own session, and that can
    land between the chunk purge and the document delete — the document's
    foreign key then rejects the delete. Reproduced by committing a chunk from a
    second session at exactly that point.
    """
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)
    result = _upload(files, user, collection, "in-flight.txt")
    document = result.document
    assert document is not None
    document.status = DocumentStatus.PROCESSING
    session.add(document)
    session.commit()

    service = FileDeletionService(session)
    original = service.chunks.delete_for_document
    interloped = False

    def delete_then_interlope(document_id) -> None:
        nonlocal interloped
        original(document_id)
        if interloped:
            return
        interloped = True
        # A separate committed transaction, exactly like the ingestion worker's.
        with Session(session.get_bind()) as worker:
            worker.add(
                models.DocumentChunkRecord(
                    document_id=document_id,
                    collection_id=collection.id,
                    chunk_index=0,
                    text="late chunk",
                    embedding=[0.1],
                    chunk_metadata={},
                    embedding_model="embed",
                )
            )
            worker.commit()

    service.chunks.delete_for_document = delete_then_interlope  # type: ignore[method-assign]

    service.delete(user, collection, result.file)

    assert interloped
    with Session(session.get_bind()) as fresh:
        assert fresh.get(models.Document, document.id) is None
        assert (
            fresh.exec(
                select(models.DocumentChunkRecord).where(
                    models.DocumentChunkRecord.document_id == document.id
                )
            ).all()
            == []
        )
        assert fresh.get(models.FileNode, result.file.id) is None
