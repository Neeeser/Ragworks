"""Persistence helpers for UMAP projections and points."""

from __future__ import annotations

from typing import NamedTuple
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import func
from sqlmodel import Session, col, desc, select

from app.db import models

# How much chunk text a point carries. The plot's hover reads as a label, not a
# reader, and a projection can hold tens of thousands of points -- shipping full
# chunk text would multiply the payload by the corpus.
SNIPPET_CHARS = 160

# Raw characters fetched per chunk. Collapsing whitespace shrinks the window, so
# reading exactly one character past the limit would let an indented chunk
# collapse back under it and lose its "there is more" ellipsis. The window is
# generous, and `build_snippet` compares against the chunk's true length anyway.
SNIPPET_WINDOW_CHARS = SNIPPET_CHARS * 4


class ChunkEmbeddingRow(NamedTuple):
    """Tuple of chunk embedding data for UMAP projection."""

    chunk_id: UUID
    document_id: UUID
    chunk_index: int
    embedding: list[float]
    embedding_model: str


class UmapPointRow(NamedTuple):
    """A stored point joined to the document and chunk excerpt it came from."""

    point: models.UmapPointRecord
    document_name: str
    text_snippet: str


def build_snippet(window: str, total_chars: int) -> str:
    """Collapse a chunk excerpt's whitespace and clip it to the label budget.

    Chunk text carries the source document's line breaks and indentation; left
    as-is a one-line hover renders as a ragged block.

    `window` is the leading `SNIPPET_WINDOW_CHARS` of the chunk and
    `total_chars` its true length, so the ellipsis is exact in both directions:
    it appears whenever text was left out, and never when the whole chunk fits.
    Deciding from the window's length alone silently drops the ellipsis from any
    chunk whose whitespace collapses it back under the limit.
    """
    collapsed = " ".join(window.split())
    if len(collapsed) > SNIPPET_CHARS:
        return collapsed[:SNIPPET_CHARS].rstrip() + "…"
    if collapsed and total_chars > len(window):
        return collapsed + "…"
    return collapsed


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

    def list_points(self, projection_id: UUID) -> list[UmapPointRow]:
        """Return a projection's points with their document name and text snippet.

        Both are joined at read time rather than copied onto the point row: the
        stored projection would otherwise hold a second copy of a name the user
        can rename, and the plot would keep colouring and labelling points by a
        title the Files page no longer shows.

        Inner joins are complete here -- `umap_points.chunk_id` and
        `.document_id` are NOT NULL foreign keys, and deleting either parent
        purges the points first, so a point never outlives its chunk.

        Only a leading window of each chunk crosses the wire, because a
        collection's full chunk text is orders of magnitude larger than the
        coordinates the plot needs; the chunk's true length comes along so
        `build_snippet` can say whether anything was left out.
        """
        statement = (
            select(
                models.UmapPointRecord,
                col(models.Document.name),
                func.substr(col(models.DocumentChunkRecord.text), 1, SNIPPET_WINDOW_CHARS),
                func.char_length(col(models.DocumentChunkRecord.text)),
            )
            .join(
                models.DocumentChunkRecord,
                col(models.UmapPointRecord.chunk_id) == col(models.DocumentChunkRecord.id),
            )
            .join(
                models.Document,
                col(models.UmapPointRecord.document_id) == col(models.Document.id),
            )
            .where(col(models.UmapPointRecord.projection_id) == projection_id)
            .order_by(col(models.UmapPointRecord.chunk_index))
        )
        return [
            UmapPointRow(
                point=point,
                document_name=name,
                text_snippet=build_snippet(window, total),
            )
            for point, name, window, total in self.session.exec(statement).all()
        ]

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
