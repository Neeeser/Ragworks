"""Data access for collection insight snapshots and their artifacts."""

from __future__ import annotations

from typing import NamedTuple
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import func
from sqlalchemy import select as sa_select
from sqlalchemy.orm import aliased
from sqlmodel import col, desc, select

from app.db import models
from app.db.repositories.base import Repository

# How much chunk text an overlap row carries per side. The report reads as a
# comparison label, not a document reader; the map's inspector serves full text.
SNIPPET_CHARS = 200


class OverlapPairRow(NamedTuple):
    """A cross-document near-duplicate chunk pair with display context."""

    neighbor: models.InsightNeighborRecord
    chunk_index: int
    neighbor_chunk_index: int
    document_name: str
    neighbor_document_name: str
    text_snippet: str
    neighbor_text_snippet: str


class InsightRepository(Repository):
    """Persistence for insight snapshots, points, neighbors, and clusters."""

    def get_snapshot(self, collection_id: UUID) -> models.InsightSnapshotRecord | None:
        """Return the collection's most recent snapshot, any status."""
        statement = (
            select(models.InsightSnapshotRecord)
            .where(col(models.InsightSnapshotRecord.collection_id) == collection_id)
            .order_by(desc(col(models.InsightSnapshotRecord.created_at)))
            .limit(1)
        )
        return self.session.exec(statement).first()

    def get_ready_snapshot(self, collection_id: UUID) -> models.InsightSnapshotRecord | None:
        """Return the collection's most recent `ready` snapshot."""
        statement = (
            select(models.InsightSnapshotRecord)
            .where(
                col(models.InsightSnapshotRecord.collection_id) == collection_id,
                col(models.InsightSnapshotRecord.status) == models.InsightStatus.READY,
            )
            .order_by(desc(col(models.InsightSnapshotRecord.created_at)))
            .limit(1)
        )
        return self.session.exec(statement).first()

    def list_points(self, snapshot_id: UUID) -> list[tuple[models.InsightPointRecord, str]]:
        """Return a snapshot's chunk points joined to their document names.

        Names are joined at read time so a rename never leaves the map
        labelling points by a title the Files page no longer shows.
        """
        statement = (
            select(models.InsightPointRecord, col(models.Document.name))
            .join(
                models.Document,
                col(models.InsightPointRecord.document_id) == col(models.Document.id),
            )
            .where(col(models.InsightPointRecord.snapshot_id) == snapshot_id)
            .order_by(col(models.InsightPointRecord.chunk_index))
        )
        return [(point, name) for point, name in self.session.exec(statement).all()]

    def list_doc_points(
        self, snapshot_id: UUID
    ) -> list[tuple[models.InsightDocPointRecord, str]]:
        """Return a snapshot's document points joined to document names."""
        statement = (
            select(models.InsightDocPointRecord, col(models.Document.name))
            .join(
                models.Document,
                col(models.InsightDocPointRecord.document_id) == col(models.Document.id),
            )
            .where(col(models.InsightDocPointRecord.snapshot_id) == snapshot_id)
        )
        return [(point, name) for point, name in self.session.exec(statement).all()]

    def list_clusters(self, snapshot_id: UUID) -> list[models.InsightClusterRecord]:
        """Return a snapshot's clusters ordered by size, largest first."""
        statement = (
            select(models.InsightClusterRecord)
            .where(col(models.InsightClusterRecord.snapshot_id) == snapshot_id)
            .order_by(desc(col(models.InsightClusterRecord.size)))
        )
        return list(self.session.exec(statement).all())

    def list_doc_edges(self, snapshot_id: UUID) -> list[models.InsightDocEdgeRecord]:
        """Return a snapshot's document edges, strongest first."""
        statement = (
            select(models.InsightDocEdgeRecord)
            .where(col(models.InsightDocEdgeRecord.snapshot_id) == snapshot_id)
            .order_by(desc(col(models.InsightDocEdgeRecord.similarity)))
        )
        return list(self.session.exec(statement).all())

    def count_overlaps(self, snapshot_id: UUID) -> int:
        """How many canonical cross-document pairs the snapshot holds."""
        count = self.session.exec(
            select(func.count(col(models.InsightNeighborRecord.id))).where(
                col(models.InsightNeighborRecord.snapshot_id) == snapshot_id,
                col(models.InsightNeighborRecord.cross_document).is_(True),
                col(models.InsightNeighborRecord.chunk_id)
                < col(models.InsightNeighborRecord.neighbor_chunk_id),
            )
        ).one()
        return int(count)

    def list_overlaps(
        self,
        snapshot_id: UUID,
        limit: int,
        offset: int = 0,
        descending: bool = True,
    ) -> list[OverlapPairRow]:
        """Return cross-document chunk pairs with display context, paged.

        The kNN graph stores directed edges, so an A↔B pair can appear twice;
        the canonical direction (`chunk_id < neighbor_chunk_id`) keeps each
        pair once without losing pairs whose reverse edge fell outside the
        neighbor's own top-k. Offset paging over the composite similarity
        index keeps each page cheap even on very large corpora.
        """
        chunk = models.DocumentChunkRecord
        neighbor_chunk = aliased(models.DocumentChunkRecord)
        doc = models.Document
        neighbor_doc = aliased(models.Document)
        # sqlalchemy's own select: this projection is seven columns wide and
        # SQLModel's typed overloads stop at four entities.
        statement = (
            sa_select(
                models.InsightNeighborRecord,
                col(chunk.chunk_index),
                col(neighbor_chunk.chunk_index),
                col(doc.name),
                col(neighbor_doc.name),
                func.substr(col(chunk.text), 1, SNIPPET_CHARS),
                func.substr(col(neighbor_chunk.text), 1, SNIPPET_CHARS),
            )
            .join(chunk, col(models.InsightNeighborRecord.chunk_id) == col(chunk.id))
            .join(
                neighbor_chunk,
                col(models.InsightNeighborRecord.neighbor_chunk_id)
                == col(neighbor_chunk.id),
            )
            .join(doc, col(models.InsightNeighborRecord.document_id) == col(doc.id))
            .join(
                neighbor_doc,
                col(models.InsightNeighborRecord.neighbor_document_id)
                == col(neighbor_doc.id),
            )
            .where(
                col(models.InsightNeighborRecord.snapshot_id) == snapshot_id,
                col(models.InsightNeighborRecord.cross_document).is_(True),
                col(models.InsightNeighborRecord.chunk_id)
                < col(models.InsightNeighborRecord.neighbor_chunk_id),
            )
            .order_by(
                desc(col(models.InsightNeighborRecord.similarity))
                if descending
                else col(models.InsightNeighborRecord.similarity)
            )
            .offset(offset)
            .limit(limit)
        )
        return [
            OverlapPairRow(
                neighbor=row[0],
                chunk_index=row[1],
                neighbor_chunk_index=row[2],
                document_name=row[3],
                neighbor_document_name=row[4],
                text_snippet=row[5],
                neighbor_text_snippet=row[6],
            )
            for row in self.session.execute(statement).all()
        ]

    def delete_snapshot(self, snapshot_id: UUID) -> None:
        """Delete a snapshot and every artifact row hanging off it."""
        for table in (
            models.InsightPointRecord,
            models.InsightDocPointRecord,
            models.InsightNeighborRecord,
            models.InsightClusterRecord,
            models.InsightDocEdgeRecord,
        ):
            self.session.execute(
                sa_delete(table).where(col(table.snapshot_id) == snapshot_id)
            )
        self.session.execute(
            sa_delete(models.InsightSnapshotRecord).where(
                col(models.InsightSnapshotRecord.id) == snapshot_id
            )
        )

    def delete_collection_snapshots(self, collection_id: UUID) -> None:
        """Delete every snapshot (and artifacts) for a collection."""
        snapshot_ids = self.session.exec(
            select(col(models.InsightSnapshotRecord.id)).where(
                col(models.InsightSnapshotRecord.collection_id) == collection_id
            )
        ).all()
        for snapshot_id in snapshot_ids:
            self.delete_snapshot(snapshot_id)

    def purge_document(self, document_id: UUID) -> None:
        """Remove a document's artifact rows and count the drift they leave.

        Called from the chunk purge that precedes re-ingest or file deletion:
        the rows describe chunks that are about to stop existing, and the
        snapshot's `deleted_count` is what later tells the freshness check the
        fitted layout no longer matches the corpus.
        """
        point_snapshots = self.session.exec(
            select(
                col(models.InsightPointRecord.snapshot_id),
                func.count(col(models.InsightPointRecord.id)),
            )
            .where(col(models.InsightPointRecord.document_id) == document_id)
            .group_by(col(models.InsightPointRecord.snapshot_id))
        ).all()
        self.session.execute(
            sa_delete(models.InsightPointRecord).where(
                col(models.InsightPointRecord.document_id) == document_id
            )
        )
        self.session.execute(
            sa_delete(models.InsightDocPointRecord).where(
                col(models.InsightDocPointRecord.document_id) == document_id
            )
        )
        self.session.execute(
            sa_delete(models.InsightNeighborRecord).where(
                (col(models.InsightNeighborRecord.document_id) == document_id)
                | (col(models.InsightNeighborRecord.neighbor_document_id) == document_id)
            )
        )
        self.session.execute(
            sa_delete(models.InsightDocEdgeRecord).where(
                (col(models.InsightDocEdgeRecord.source_document_id) == document_id)
                | (col(models.InsightDocEdgeRecord.target_document_id) == document_id)
            )
        )
        for snapshot_id, removed in point_snapshots:
            snapshot = self.session.get(models.InsightSnapshotRecord, snapshot_id)
            if snapshot is not None:
                snapshot.deleted_count += int(removed)
                snapshot.point_count = max(0, snapshot.point_count - int(removed))
                self.session.add(snapshot)
