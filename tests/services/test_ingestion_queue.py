"""Behavior tests for the bounded, durable ingestion queue (issue #138).

The bug: unbounded per-upload background tasks exhausted the DB pool and
stranded documents in `processing` forever. The contracts pinned here are the
fix: concurrency is bounded by the worker pool, a document is claimed by
exactly one worker, and startup recovery requeues stranded work.
"""

from __future__ import annotations

import threading
import time
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository
from app.schemas.enums import DocumentStatus
from app.services.ingestion_queue import IngestionQueue


def _create_user(session: Session) -> models.User:
    user = models.User(
        email=f"queue-{uuid4().hex[:8]}@example.com",
        full_name="Queue Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Queue Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_document(
    session: Session,
    user: models.User,
    collection: models.Collection,
    status: DocumentStatus,
) -> models.Document:
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=status,
        embedding_model="stub-model",
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def test_worker_pool_bounds_concurrent_ingestion(monkeypatch: pytest.MonkeyPatch) -> None:
    """Six queued documents never run more than the configured 2 at once."""
    lock = threading.Lock()
    active = 0
    max_active = 0
    ran: list[UUID] = []
    done = threading.Event()

    def tracked_ingestion(document_id: UUID) -> None:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1
            ran.append(document_id)
            if len(ran) == 6:
                done.set()

    monkeypatch.setattr("app.services.ingestion.run_document_ingestion", tracked_ingestion)
    queue = IngestionQueue()
    queue.start(worker_count=2)
    try:
        ids = [uuid4() for _ in range(6)]
        for document_id in ids:
            queue.enqueue(document_id)
        assert done.wait(timeout=5), "queue did not drain all six documents"
    finally:
        queue.stop()
    assert max_active <= 2
    assert sorted(ran) == sorted(ids)


def test_enqueue_without_start_runs_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    """A never-started queue (scripts, tests) still ingests, synchronously."""
    ran: list[UUID] = []
    monkeypatch.setattr("app.services.ingestion.run_document_ingestion", ran.append)
    document_id = uuid4()
    IngestionQueue().enqueue(document_id)
    assert ran == [document_id]


def test_claim_for_ingestion_hands_a_document_to_exactly_one_worker(
    session: Session,
) -> None:
    """The second claim on the same document loses; the row lands `processing`."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    document = _create_document(session, user, collection, DocumentStatus.PENDING)

    repository = DocumentRepository(session)
    assert repository.claim_for_ingestion(document.id) is True
    session.commit()
    assert repository.claim_for_ingestion(document.id) is False
    session.commit()

    with Session(session.get_bind()) as fresh:
        persisted = fresh.get(models.Document, document.id)
        assert persisted is not None
        assert persisted.status == DocumentStatus.PROCESSING


def test_recover_requeues_stranded_processing_and_drains_pending(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Startup recovery resets `processing` to `pending` and enqueues everything.

    This is the regression contract for the stranded-forever half of the bug:
    a document left `processing` by a dead process re-runs on the next boot
    instead of sitting unrecoverable with no error message.
    """
    user = _create_user(session)
    collection = _create_collection(session, user)
    stranded = _create_document(session, user, collection, DocumentStatus.PROCESSING)
    queued = _create_document(session, user, collection, DocumentStatus.PENDING)
    finished = _create_document(session, user, collection, DocumentStatus.READY)

    enqueued: list[UUID] = []
    queue = IngestionQueue()
    monkeypatch.setattr(queue, "enqueue", enqueued.append)
    queue.recover()

    assert set(enqueued) == {stranded.id, queued.id}
    with Session(session.get_bind()) as fresh:
        restored = fresh.get(models.Document, stranded.id)
        untouched = fresh.get(models.Document, finished.id)
        assert restored is not None
        assert restored.status == DocumentStatus.PENDING
        assert untouched is not None
        assert untouched.status == DocumentStatus.READY


def test_run_document_ingestion_skips_a_document_it_cannot_claim(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A duplicate enqueue of an already-claimed document is a silent no-op."""
    from app.services import ingestion as ingestion_module

    user = _create_user(session)
    collection = _create_collection(session, user)
    document = _create_document(session, user, collection, DocumentStatus.PROCESSING)

    def _explode(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("IngestionService must not run for an unclaimable document")

    monkeypatch.setattr(ingestion_module, "IngestionService", _explode)
    ingestion_module.run_document_ingestion(document.id)
