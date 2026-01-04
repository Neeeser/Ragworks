"""Persistence helpers for UMAP projections and points."""

from __future__ import annotations

from typing import List, NamedTuple, Optional
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.db import models


class ChunkEmbeddingRow(NamedTuple):
    """Tuple of chunk embedding data for UMAP projection."""

    chunk_id: UUID
    document_id: UUID
    chunk_index: int
    embedding: List[float]
    embedding_model: str


class UmapRepository:
    """Data access helpers for UMAP projections."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def list_chunk_embeddings(self, collection_id: UUID) -> List[ChunkEmbeddingRow]:
        """Return chunk embeddings for a collection."""
        statement = select(
            models.DocumentChunkRecord.id,
            models.DocumentChunkRecord.document_id,
            models.DocumentChunkRecord.chunk_index,
            models.DocumentChunkRecord.embedding,
            models.DocumentChunkRecord.embedding_model,
        ).where(models.DocumentChunkRecord.collection_id == collection_id)
        rows = self.session.exec(statement).all()
        return [ChunkEmbeddingRow(*row) for row in rows]

    def get_latest_projection(
        self, collection_id: UUID
    ) -> Optional[models.UmapProjectionRecord]:
        """Return the most recent projection for a collection."""
        statement = (
            select(models.UmapProjectionRecord)
            .where(models.UmapProjectionRecord.collection_id == collection_id)
            .order_by(models.UmapProjectionRecord.created_at.desc())  # pylint: disable=no-member
            .limit(1)
        )
        return self.session.exec(statement).first()

    def list_points(self, projection_id: UUID) -> List[models.UmapPointRecord]:
        """Return all points for a projection."""
        statement = (
            select(models.UmapPointRecord)
            .where(models.UmapPointRecord.projection_id == projection_id)
            .order_by(models.UmapPointRecord.chunk_index)
        )
        return self.session.exec(statement).all()

    def delete_collection_projections(self, collection_id: UUID) -> None:
        """Delete all projections and points for a collection."""
        projection_ids = self.session.exec(
            select(models.UmapProjectionRecord.id).where(
                models.UmapProjectionRecord.collection_id == collection_id
            )
        ).all()
        if projection_ids:
            self.session.exec(
                sa_delete(models.UmapPointRecord).where(
                    models.UmapPointRecord.projection_id.in_(projection_ids)  # pylint: disable=no-member
                )
            )
        self.session.exec(
            sa_delete(models.UmapProjectionRecord).where(
                models.UmapProjectionRecord.collection_id == collection_id
            )
        )
