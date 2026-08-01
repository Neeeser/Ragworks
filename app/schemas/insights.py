"""Wire types for the collection insights surface (map, graph, overlaps)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import InsightSpace, InsightStatus

if TYPE_CHECKING:
    from app.db import models

# Overlap snippets cross the wire collapsed to one line: chunk text carries
# the source document's newlines and indentation, and the report renders a
# label-sized comparison, not a reader.


def collapse_snippet(text: str) -> str:
    """Collapse whitespace so a snippet renders as a single clean line."""
    return " ".join(text.split())


class InsightSnapshotRead(DateTimeConfigMixin, BaseModel):
    """Snapshot metadata: which space, how fresh, and how complete."""

    id: UUID
    collection_id: UUID
    space: InsightSpace
    space_label: str
    status: InsightStatus
    error_message: str | None
    point_count: int
    document_count: int
    cluster_count: int
    coverage: float
    transformed_count: int
    deleted_count: int
    fitted_count: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, snapshot: models.InsightSnapshotRecord) -> InsightSnapshotRead:
        """Build the wire shape from a snapshot row."""
        return cls.model_validate(snapshot, from_attributes=True)


class InsightOverviewRead(BaseModel):
    """The page's chrome state: served snapshot plus any in-flight work."""

    snapshot: InsightSnapshotRead | None
    # The latest non-ready snapshot: `computing` while a build runs, or
    # `failed` with its error. None once the work landed.
    active: InsightSnapshotRead | None
    chunk_total: int
    can_compute: bool


class InsightPointRead(BaseModel):
    """One chunk's position on the map."""

    id: UUID
    chunk_id: UUID
    document_id: UUID
    document_name: str
    chunk_index: int
    x: float
    y: float
    cluster_index: int | None


class InsightDocPointRead(BaseModel):
    """One document's aggregate position on the map / node in the graph."""

    document_id: UUID
    document_name: str
    x: float
    y: float
    chunk_count: int


class InsightClusterRead(BaseModel):
    """A labelled cluster region on the map."""

    cluster_index: int
    label: str
    size: int
    x: float
    y: float


class InsightMapRead(BaseModel):
    """Everything the map view renders."""

    snapshot: InsightSnapshotRead
    points: list[InsightPointRead]
    documents: list[InsightDocPointRead]
    clusters: list[InsightClusterRead]


class InsightDocEdgeRead(BaseModel):
    """A document-similarity edge in the graph view."""

    source_document_id: UUID
    target_document_id: UUID
    similarity: float
    collision_count: int


class InsightGraphRead(BaseModel):
    """Document nodes and their similarity edges."""

    snapshot: InsightSnapshotRead
    documents: list[InsightDocPointRead]
    edges: list[InsightDocEdgeRead]


class OverlapSideRead(BaseModel):
    """One side of a cross-document overlap pair."""

    chunk_id: UUID
    document_id: UUID
    document_name: str
    chunk_index: int
    text_snippet: str


class InsightOverlapRead(BaseModel):
    """A cross-document chunk pair retrieval is likely to confuse."""

    similarity: float
    a: OverlapSideRead
    b: OverlapSideRead


class InsightOverlapsRead(BaseModel):
    """The ranked confusability report."""

    snapshot: InsightSnapshotRead
    pairs: list[InsightOverlapRead]


class InsightProbeRequest(BaseModel):
    """A query to drop onto the map."""

    query: str = Field(min_length=1, max_length=2000)


class InsightProbeMatchRead(BaseModel):
    """A chunk ranked against a probe query, with exact similarity."""

    chunk_id: UUID
    document_id: UUID
    document_name: str
    chunk_index: int
    similarity: float
    text_snippet: str


class InsightProbeRead(BaseModel):
    """Where a query lands on the map and what sits closest to it."""

    x: float
    y: float
    space: InsightSpace
    space_label: str
    matches: list[InsightProbeMatchRead]
