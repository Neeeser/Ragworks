"""Repositories for documents and their stored chunks."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import func
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository


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

    def count_by_user(self) -> dict[UUID, int]:
        """Return a mapping of user id -> number of documents they own."""
        statement = select(
            models.Document.user_id,
            func.count(),  # pylint: disable=not-callable
        ).group_by(col(models.Document.user_id))
        return {user_id: count for user_id, count in self.session.exec(statement).all()}


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

        Stored UMAP points reference chunk rows (`umap_points.chunk_id`), so
        the document's stale points are purged first — after a re-ingest or
        delete they describe chunks that no longer exist anyway.
        """
        self.session.execute(
            sa_delete(models.UmapPointRecord).where(
                col(models.UmapPointRecord.document_id) == document_id,
            )
        )
        for chunk in self.list_for_document(document_id):
            self.session.delete(chunk)
        self.session.flush()
