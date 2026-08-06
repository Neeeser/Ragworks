"""Repositories for documents and their stored chunks."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func, not_
from sqlalchemy import delete as sa_delete
from sqlalchemy import update as sa_update
from sqlalchemy.engine import CursorResult
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository


def reached_the_index(document: models.Document) -> bool:
    """Whether one document is queryable.

    Indexed chunks are the test rather than the status alone: a document that
    produced none is invisible to retrieval however its row is labelled.
    `_did_not_reach_the_index` is the SQL form of this negated, and the two are
    pinned together by `tests/db/test_unindexed_documents.py`.
    """
    return document.status == models.DocumentStatus.READY and document.num_chunks > 0


def _reached_the_index() -> ColumnElement[bool]:
    """`reached_the_index` as a WHERE clause."""
    return and_(
        col(models.Document.status) == models.DocumentStatus.READY,
        col(models.Document.num_chunks) > 0,
    )


def _did_not_reach_the_index() -> ColumnElement[bool]:
    """`reached_the_index` negated, as a WHERE clause."""
    return not_(_reached_the_index())


@dataclass(frozen=True, slots=True)
class StoredChunkContext:
    """Stored chunk fields needed to render focused trace context."""

    document_id: UUID
    chunk_index: int
    text: str
    filename: str
    chunk_count: int


class DocumentRepository(Repository):
    """Data access helpers for documents."""

    def list_for_collection(self, collection_id: UUID) -> list[models.Document]:
        """List documents in a collection."""
        statement = select(models.Document).where(
            models.Document.collection_id == collection_id,
        )
        return list(self.session.exec(statement).all())

    def indexed_counts_by_collection(self, collection_ids: Iterable[UUID]) -> dict[UUID, int]:
        """Count documents per collection that reached the index, in one query.

        Indexed chunks are part of the test: a `ready` document holding none is
        invisible to retrieval, and counting it here reports a corpus as fully
        indexed while `unindexed_counts_by_collection` still offers the repair.
        """
        ids = list(collection_ids)
        if not ids:
            return {}
        statement = (
            select(
                col(models.Document.collection_id),
                func.count(col(models.Document.id)),
            )
            .where(col(models.Document.collection_id).in_(ids), _reached_the_index())
            .group_by(col(models.Document.collection_id))
        )
        return {row[0]: int(row[1]) for row in self.session.exec(statement).all()}

    def unindexed_counts_by_collection(self, collection_ids: Iterable[UUID]) -> dict[UUID, int]:
        """Count documents per collection that did not reach the index.

        The SQL form of `reached_the_index`, negated; the two are pinned
        together by `tests/db/test_unindexed_documents.py`. Documents being
        ingested right now are included: they are not in the index yet, which
        is what a coverage number reports.
        """
        ids = list(collection_ids)
        if not ids:
            return {}
        statement = (
            select(
                col(models.Document.collection_id),
                func.count(col(models.Document.id)),
            )
            .where(col(models.Document.collection_id).in_(ids), _did_not_reach_the_index())
            .group_by(col(models.Document.collection_id))
        )
        return {row[0]: int(row[1]) for row in self.session.exec(statement).all()}

    def list_unindexed_for_collection(
        self, collection_id: UUID, *, names: Iterable[str] | None = None
    ) -> list[models.Document]:
        """Documents in one collection that did not reach the index and are idle.

        `processing` is excluded — a worker holds that row, and requeueing it
        would put two pipelines on one document. `pending` is *included*: it
        means nothing has ingested the document yet, and for a corpus ingested
        synchronously (eval provisioning) nothing ever will unless it is
        requeued. `names` narrows the sweep to a known set of file names.
        """
        statement = select(models.Document).where(
            col(models.Document.collection_id) == collection_id,
            col(models.Document.status) != models.DocumentStatus.PROCESSING,
            _did_not_reach_the_index(),
        )
        if names is not None:
            statement = statement.where(col(models.Document.name).in_(list(names)))
        return list(self.session.exec(statement).all())

    def mark_pending(self, documents: Iterable[models.Document]) -> list[UUID]:
        """Reset documents to `pending` for the queue; the caller commits.

        The queue's claim only ever moves a `pending` row, so a `failed`
        document handed straight to a worker is dropped without a trace.
        """
        ids: list[UUID] = []
        for document in documents:
            document.status = models.DocumentStatus.PENDING
            document.error_message = None
            self.session.add(document)
            ids.append(document.id)
        return ids

    def add(self, document: models.Document) -> models.Document:
        """Persist a new document and return it."""
        return self._add(document)

    def get(self, document_id: UUID) -> models.Document | None:
        """Return a document by id if one exists."""
        return self.session.get(models.Document, document_id)

    def get_for_user(self, document_id: UUID, user_id: UUID) -> models.Document | None:
        """Return a document only when it exists and is owned by the user."""
        document = self.session.get(models.Document, document_id)
        if not document or document.user_id != user_id:
            return None
        return document

    def get_for_file(self, file_id: UUID) -> models.Document | None:
        """Return the ingestion record for a file node, if one exists."""
        statement = select(models.Document).where(models.Document.file_id == file_id)
        return self.session.exec(statement).first()

    def list_missing_file(self) -> list[models.Document]:
        """Return documents that predate the file tree (no `file_id` yet)."""
        statement = select(models.Document).where(col(models.Document.file_id).is_(None))
        return list(self.session.exec(statement).all())

    def unresolved_ingestion_run_ids(self, run_ids: Iterable[UUID]) -> set[UUID]:
        """Return which of the given run ids still name a not-READY document.

        Used to scope the ingestion-failures diagnostic to failures that are
        still true: a retried document's `ingestion_run_id` moves onto its new
        attempt, so a prior FAILED run drops out of this set the moment the
        document it named becomes READY (or is deleted) -- the diagnostic
        self-clears instead of warning forever.
        """
        ids = list(run_ids)
        if not ids:
            return set()
        statement = select(col(models.Document.ingestion_run_id)).where(
            col(models.Document.ingestion_run_id).in_(ids),
            col(models.Document.status) != models.DocumentStatus.READY,
        )
        return {row for row in self.session.exec(statement).all() if row is not None}

    def delete_ingestion_events(self, document_id: UUID) -> None:
        """Delete the ingestion audit rows referencing a document.

        Part of the document purge cascade: `ingestion_events.document_id`
        is a plain FK, so the events must go before the document row.
        """
        self.session.execute(
            sa_delete(models.IngestionEvent).where(
                col(models.IngestionEvent.document_id) == document_id,
            )
        )

    def claim_for_ingestion(self, document_id: UUID) -> bool:
        """Atomically move a `pending` document to `processing`; report success.

        The single-row conditional UPDATE is the ingestion queue's dedupe
        gate: two workers (or a worker racing a stale enqueue) can both hold
        the same id, but only one flips the status and proceeds.
        """
        result = self.session.execute(
            sa_update(models.Document)
            .where(
                col(models.Document.id) == document_id,
                col(models.Document.status) == models.DocumentStatus.PENDING,
            )
            .values(status=models.DocumentStatus.PROCESSING)
        )
        # `Session.execute` is typed as the base `Result`, but a DML statement
        # always returns a `CursorResult` (which carries `rowcount`).
        assert isinstance(result, CursorResult)
        return bool(result.rowcount)

    def requeue_stranded_processing(self) -> int:
        """Reset every `processing` document back to `pending`; return the count.

        Startup recovery only: a document mid-ingest when the process died is
        stranded in `processing` with no worker attached — requeueing it is
        safe because re-ingestion overwrites the same `{document_id}:{order}`
        chunk ids.
        """
        result = self.session.execute(
            sa_update(models.Document)
            .where(col(models.Document.status) == models.DocumentStatus.PROCESSING)
            .values(status=models.DocumentStatus.PENDING, error_message=None)
        )
        assert isinstance(result, CursorResult)
        return int(result.rowcount)

    def pending_ids(self) -> list[UUID]:
        """Return every `pending` document id, oldest first."""
        statement = (
            select(col(models.Document.id))
            .where(col(models.Document.status) == models.DocumentStatus.PENDING)
            .order_by(col(models.Document.created_at))
        )
        return list(self.session.exec(statement).all())

    def count_by_user(self) -> dict[UUID, int]:
        """Return a mapping of user id -> number of documents they own.

        Documents inside eval collections are excluded, matching the
        collection count beside it: a benchmark corpus is scaffolding the
        Evals section materializes, so counting it as the user's own
        overstates their storage by the size of every eval they have run.
        """
        statement = (
            select(
                models.Document.user_id,
                func.count(),
            )
            .join(
                models.Collection,
                col(models.Collection.id) == col(models.Document.collection_id),
            )
            .where(col(models.Collection.system_purpose).is_(None))
            .group_by(col(models.Document.user_id))
        )
        return dict(self.session.exec(statement).all())


class ChunkRepository(Repository):
    """Data access helpers for document chunks."""

    def add_many(self, chunks: Iterable[models.DocumentChunkRecord]) -> None:
        """Persist multiple chunk records."""
        self.session.add_all(list(chunks))
        self.session.flush()

    def get(self, chunk_id: UUID) -> models.DocumentChunkRecord | None:
        """Return a chunk by id if one exists."""
        return self.session.get(models.DocumentChunkRecord, chunk_id)

    def get_by_index(
        self, document_id: UUID, chunk_index: int
    ) -> models.DocumentChunkRecord | None:
        """Return the chunk stored at a position within a document, if any."""
        statement = select(models.DocumentChunkRecord).where(
            models.DocumentChunkRecord.document_id == document_id,
            models.DocumentChunkRecord.chunk_index == chunk_index,
        )
        return self.session.exec(statement).first()

    def list_context_by_positions_for_user(
        self,
        positions: Iterable[tuple[UUID, int]],
        user_id: UUID,
    ) -> list[StoredChunkContext]:
        """Resolve stored chunk positions owned by one user in one query."""
        requested = set(positions)
        if not requested:
            return []
        document_ids = {document_id for document_id, _ in requested}
        chunk_indexes = {chunk_index for _, chunk_index in requested}
        statement = (
            select(
                models.DocumentChunkRecord,
                models.Document,
            )
            .join(
                models.Document,
                col(models.Document.id) == col(models.DocumentChunkRecord.document_id),
            )
            .where(
                models.Document.user_id == user_id,
                col(models.DocumentChunkRecord.document_id).in_(document_ids),
                col(models.DocumentChunkRecord.chunk_index).in_(chunk_indexes),
            )
        )
        return [
            StoredChunkContext(
                document_id=chunk.document_id,
                chunk_index=chunk.chunk_index,
                text=chunk.text,
                filename=document.name,
                chunk_count=document.num_chunks,
            )
            for chunk, document in self.session.exec(statement).all()
            if (chunk.document_id, chunk.chunk_index) in requested
        ]

    def list_for_documents(self, document_ids: Iterable[UUID]) -> list[models.DocumentChunkRecord]:
        """Return every chunk of the given documents, in document/index order."""
        ids = list(document_ids)
        if not ids:
            return []
        statement = (
            select(models.DocumentChunkRecord)
            .where(col(models.DocumentChunkRecord.document_id).in_(ids))
            .order_by(
                col(models.DocumentChunkRecord.document_id),
                col(models.DocumentChunkRecord.chunk_index),
            )
        )
        return list(self.session.exec(statement).all())

    def list_for_document(self, document_id: UUID) -> list[models.DocumentChunkRecord]:
        """List chunks belonging to a document in their source order."""
        statement = (
            select(models.DocumentChunkRecord)
            .where(
                models.DocumentChunkRecord.document_id == document_id,
            )
            .order_by(col(models.DocumentChunkRecord.chunk_index))
        )
        return list(self.session.exec(statement).all())

    def delete_for_document(self, document_id: UUID) -> None:
        """Delete every stored chunk for a document (retry/delete paths).

        Stored insight artifacts reference chunk rows, so the document's
        stale points/neighbors are purged first — after a re-ingest or delete
        they describe chunks that no longer exist anyway. The purge also
        books the removals as snapshot drift, which is what later tells the
        freshness check the fitted layout no longer matches the corpus.
        """
        from app.db.repositories.insight import InsightRepository

        InsightRepository(self.session).purge_document(document_id)
        for chunk in self.list_for_document(document_id):
            self.session.delete(chunk)
        self.session.flush()
