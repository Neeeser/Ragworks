"""The unindexed-document rule, pinned across its Python and SQL forms.

`reached_the_index` answers for one loaded row; `list_unindexed_for_collection`
and `unindexed_counts_by_collection` answer for a set, in SQL. Two expressions
of one rule drift silently — a status added to the enum, a chunk-count guard
changed on one side — and the drift surfaces as an eval run that reports a
document as indexed while the repair sweep keeps requeueing it.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository, reached_the_index

# Every combination that can exist on a document row: each status, with and
# without indexed chunks.
_ROWS: tuple[tuple[models.DocumentStatus, int], ...] = tuple(
    (status, chunks) for status in models.DocumentStatus for chunks in (0, 3)
)


@pytest.fixture(name="seeded")
def seeded_fixture(session: Session) -> models.Collection:
    """A collection holding one document per (status, chunk count) pair."""
    user = models.User(email="docs@example.com", full_name="Docs", hashed_password="hashed")
    session.add(user)
    session.commit()
    collection = models.Collection(user_id=user.id, name="Statuses")
    session.add(collection)
    session.commit()
    for status, chunks in _ROWS:
        session.add(
            models.Document(
                user_id=user.id,
                collection_id=collection.id,
                name=f"{status.value}-{chunks}.txt",
                content_type="text/plain",
                embedding_model="stub-embedder",
                status=status,
                num_chunks=chunks,
            )
        )
    session.commit()
    return collection


def test_sql_selection_matches_the_row_level_predicate(
    session: Session, seeded: models.Collection
) -> None:
    """The listing selects exactly the idle rows the pure predicate rejects."""
    repository = DocumentRepository(session)
    everything = repository.list_for_collection(seeded.id)
    expected = {
        document.name
        for document in everything
        if not reached_the_index(document)
        and document.status != models.DocumentStatus.PROCESSING
    }
    selected = {
        document.name for document in repository.list_unindexed_for_collection(seeded.id)
    }
    assert selected == expected
    # A ready row with no chunks is the case a status-only check would miss.
    assert "ready-0.txt" in selected
    assert "ready-3.txt" not in selected
    # A row a worker is holding is never requeued out from under it.
    assert "processing-0.txt" not in selected


def test_counts_include_documents_still_being_ingested(
    session: Session, seeded: models.Collection
) -> None:
    """Coverage counts what is not in the index; the sweep skips only the busy.

    The two deliberately differ: `processing` is not in the index yet, so a
    coverage number that hid it would overstate what a run could retrieve.
    """
    repository = DocumentRepository(session)
    everything = repository.list_for_collection(seeded.id)
    counted = repository.unindexed_counts_by_collection([seeded.id])[seeded.id]
    listed = len(repository.list_unindexed_for_collection(seeded.id))
    busy = sum(
        1
        for document in everything
        if document.status == models.DocumentStatus.PROCESSING
        and not reached_the_index(document)
    )
    assert busy > 0
    assert counted == listed + busy
    assert counted == sum(
        1 for document in everything if not reached_the_index(document)
    )


def test_names_narrows_the_sweep(session: Session, seeded: models.Collection) -> None:
    """A caller repairing one sampled subset never touches the rest."""
    repository = DocumentRepository(session)
    selected = repository.list_unindexed_for_collection(seeded.id, names={"failed-0.txt"})
    assert [document.name for document in selected] == ["failed-0.txt"]


def test_mark_pending_clears_the_previous_failure(
    session: Session, seeded: models.Collection
) -> None:
    """Requeued rows are claimable and carry no stale error message."""
    repository = DocumentRepository(session)
    failed = [
        document
        for document in repository.list_for_collection(seeded.id)
        if document.status == models.DocumentStatus.FAILED
    ]
    for document in failed:
        document.error_message = "provider returned 503"
    session.commit()

    ids = repository.mark_pending(failed)
    session.commit()

    assert set(ids) == {document.id for document in failed}
    with Session(session.get_bind()) as fresh:
        for document_id in ids:
            stored = fresh.get(models.Document, document_id)
            assert stored is not None
            assert stored.status == models.DocumentStatus.PENDING
            assert stored.error_message is None


def test_a_collection_with_no_documents_selects_nothing(session: Session) -> None:
    """An empty collection is not an error and not a sweep over everything."""
    user = models.User(email="empty@example.com", full_name="Empty", hashed_password="hashed")
    session.add(user)
    session.commit()
    collection = models.Collection(user_id=user.id, name="Empty")
    session.add(collection)
    session.commit()
    repository = DocumentRepository(session)
    assert repository.list_unindexed_for_collection(collection.id) == []
    assert repository.unindexed_counts_by_collection([uuid4()]) == {}
