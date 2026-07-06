"""Persistence helpers for UMAP projections and points."""

from __future__ import annotations

from typing import NamedTuple
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, desc, select

from app.db import models


class ChunkEmbeddingRow(NamedTuple):
    """Tuple of chunk embedding data for UMAP projection."""

    chunk_id: UUID
    document_id: UUID
    chunk_index: int
    embedding: list[float]
    embedding_model: str


class UmapRepository:
    """Data access helpers for UMAP projections."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def list_chunk_embeddings(self, collection_id: UUID) -> list[ChunkEmbeddingRow]:
        """Return chunk embeddings for a collection.

        Selects the full row (rather than a 5-column tuple) because SQLModel's
        `select()` tuple overloads only go up to four typed entities.
        """
        statement = select(models.DocumentChunkRecord).where(
            col(models.DocumentChunkRecord.collection_id) == collection_id
        )
        rows = self.session.exec(statement).all()
        return [
            ChunkEmbeddingRow(
                chunk_id=row.id,
                document_id=row.document_id,
                chunk_index=row.chunk_index,
                embedding=row.embedding,
                embedding_model=row.embedding_model,
            )
            for row in rows
        ]

    def get_latest_projection(
        self, collection_id: UUID
    ) -> models.UmapProjectionRecord | None:
        """Return the most recent projection for a collection."""
        statement = (
            select(models.UmapProjectionRecord)
            .where(col(models.UmapProjectionRecord.collection_id) == collection_id)
            .order_by(desc(col(models.UmapProjectionRecord.created_at)))
            .limit(1)
        )
        return self.session.exec(statement).first()

    def list_points(self, projection_id: UUID) -> list[models.UmapPointRecord]:
        """Return all points for a projection."""
        statement = (
            select(models.UmapPointRecord)
            .where(col(models.UmapPointRecord.projection_id) == projection_id)
            .order_by(col(models.UmapPointRecord.chunk_index))
        )
        return list(self.session.exec(statement).all())

    def delete_collection_projections(self, collection_id: UUID) -> None:
        """Delete all projections and points for a collection."""
        projection_ids = self.session.exec(
            select(col(models.UmapProjectionRecord.id)).where(
                col(models.UmapProjectionRecord.collection_id) == collection_id
            )
        ).all()
        if projection_ids:
            self.session.exec(
                sa_delete(models.UmapPointRecord).where(
                    col(models.UmapPointRecord.projection_id).in_(projection_ids)
                )
            )
        self.session.exec(
            sa_delete(models.UmapProjectionRecord).where(
                col(models.UmapProjectionRecord.collection_id) == collection_id
            )
        )
