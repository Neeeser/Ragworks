"""Repositories for documents and their stored chunks."""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import func
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository


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
        statement = select(models.Document).where(
            col(models.Document.file_id).is_(None)
        )
        return list(self.session.exec(statement).all())

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

    def list_for_document(self, document_id: UUID) -> list[models.DocumentChunkRecord]:
        """List chunks belonging to a document."""
        statement = select(models.DocumentChunkRecord).where(
            models.DocumentChunkRecord.document_id == document_id,
        )
        return list(self.session.exec(statement).all())

    def delete_for_document(self, document_id: UUID) -> None:
        """Delete every stored chunk for a document (retry/delete paths)."""
        for chunk in self.list_for_document(document_id):
            self.session.delete(chunk)
        self.session.flush()
