"""Collection insight tables: one snapshot per collection plus its artifacts.

A snapshot is the unit of atomic swap: a recompute builds a fresh snapshot's
rows and deletes the old one only once the new one is `ready`, so readers
never see a half-written map. Every artifact row (points, doc points,
neighbors, clusters, doc edges) hangs off the snapshot by foreign key.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import Boolean, Column, Float, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import InsightSpace, InsightStatus


class InsightSnapshotRecord(SQLModel, TimestampMixin, table=True):
    """Metadata and freshness accounting for one collection's insight set."""

    __tablename__ = "insight_snapshots"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    space: InsightSpace = Field(sa_column=Column(String, nullable=False))
    # What produced the vectors: the embedding model name for semantic space,
    # "tf-idf" for lexical. Display metadata, never dispatch.
    space_label: str = Field(sa_column=Column(String, nullable=False))
    status: InsightStatus = Field(sa_column=Column(String, nullable=False))
    error_message: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    point_count: int = Field(default=0, nullable=False)
    document_count: int = Field(default=0, nullable=False)
    cluster_count: int = Field(default=0, nullable=False)
    # Fraction of the collection's chunks the space could place (semantic
    # space with partial embedding coverage plots what it can, honestly).
    coverage: float = Field(default=1.0, sa_column=Column(Float, nullable=False))
    # Drift accounting: points placed by incremental transform since the last
    # full fit, and fitted points since deleted. Either crossing the refit
    # threshold triggers a background full recompute.
    transformed_count: int = Field(default=0, nullable=False)
    deleted_count: int = Field(default=0, nullable=False)
    fitted_count: int = Field(default=0, nullable=False)


class InsightPointRecord(SQLModel, table=True):
    """A chunk's 2D position (and cluster membership) within a snapshot."""

    __tablename__ = "insight_points"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    snapshot_id: UUID = Field(foreign_key="insight_snapshots.id", nullable=False, index=True)
    chunk_id: UUID = Field(foreign_key="document_chunks.id", nullable=False, index=True)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    chunk_index: int = Field(nullable=False)
    x: float = Field(sa_column=Column(Float, nullable=False))
    y: float = Field(sa_column=Column(Float, nullable=False))
    # None = noise under HDBSCAN; the map renders unclustered points plainly.
    cluster_index: int | None = Field(default=None, nullable=True)


class InsightDocPointRecord(SQLModel, table=True):
    """A document's aggregate 2D position (mean of its chunk points)."""

    __tablename__ = "insight_doc_points"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    snapshot_id: UUID = Field(foreign_key="insight_snapshots.id", nullable=False, index=True)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    x: float = Field(sa_column=Column(Float, nullable=False))
    y: float = Field(sa_column=Column(Float, nullable=False))
    chunk_count: int = Field(default=0, nullable=False)


class InsightNeighborRecord(SQLModel, table=True):
    """One directed kNN edge between two chunks, with exact similarity.

    This single artifact powers the graph edges and the overlap report; the
    document ids are denormalized so cross-document queries never join back
    through `document_chunks`.
    """

    __tablename__ = "insight_neighbors"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    snapshot_id: UUID = Field(foreign_key="insight_snapshots.id", nullable=False, index=True)
    chunk_id: UUID = Field(foreign_key="document_chunks.id", nullable=False, index=True)
    neighbor_chunk_id: UUID = Field(foreign_key="document_chunks.id", nullable=False, index=True)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    neighbor_document_id: UUID = Field(foreign_key="documents.id", nullable=False)
    similarity: float = Field(sa_column=Column(Float, nullable=False))
    cross_document: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, index=True)
    )


class InsightClusterRecord(SQLModel, table=True):
    """A discovered cluster with its locally computed term label."""

    __tablename__ = "insight_clusters"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    snapshot_id: UUID = Field(foreign_key="insight_snapshots.id", nullable=False, index=True)
    cluster_index: int = Field(nullable=False)
    # Top distinguishing terms, joined with " · " — c-TF-IDF over the
    # cluster's chunk text, computed locally.
    label: str = Field(sa_column=Column(String, nullable=False))
    size: int = Field(default=0, nullable=False)
    # 2D centroid, where the map anchors the cluster's label.
    x: float = Field(sa_column=Column(Float, nullable=False))
    y: float = Field(sa_column=Column(Float, nullable=False))


class InsightDocEdgeRecord(SQLModel, table=True):
    """A document-to-document similarity edge for the graph view."""

    __tablename__ = "insight_doc_edges"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    snapshot_id: UUID = Field(foreign_key="insight_snapshots.id", nullable=False, index=True)
    source_document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    target_document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    similarity: float = Field(sa_column=Column(Float, nullable=False))
    # How many cross-document near-duplicate chunk pairs sit on this edge —
    # the "retrieval will mix these up" signal.
    collision_count: int = Field(default=0, nullable=False)
