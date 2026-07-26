"""Schema models for visualization payloads."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin

if TYPE_CHECKING:
    from app.db import models
    from app.visualization.umap.repository import UmapPointRow


class UmapComputeRequest(BaseModel):
    """Request payload for computing a UMAP projection."""

    n_neighbors: int = Field(default=15, ge=2)
    min_dist: float = Field(default=0.1, ge=0.0, le=1.0)
    metric: str = Field(default="cosine")
    random_state: int = Field(default=42)
    n_components: int = Field(default=2, ge=2, le=2)


class UmapProjectionRead(DateTimeConfigMixin, BaseModel):
    """Projection metadata returned to API clients."""

    id: UUID
    collection_id: UUID
    embedding_model: str
    n_neighbors: int
    min_dist: float
    metric: str
    n_components: int
    random_state: int
    point_count: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, projection: models.UmapProjectionRecord) -> UmapProjectionRead:
        """Build a schema instance from a projection model."""
        return cls(
            id=projection.id,
            collection_id=projection.collection_id,
            embedding_model=projection.embedding_model,
            n_neighbors=projection.n_neighbors,
            min_dist=projection.min_dist,
            metric=projection.metric,
            n_components=projection.n_components,
            random_state=projection.random_state,
            point_count=projection.point_count,
            created_at=projection.created_at,
            updated_at=projection.updated_at,
        )


class UmapPointRead(BaseModel):
    """UMAP point details returned to API clients.

    `document_name` and `text_snippet` are joined at read time rather than
    stored: they are what lets the plot colour a point by its source document
    and name it on hover, and a point that carried only ids would force the
    browser into one request per document to say anything about it.
    """

    id: UUID
    chunk_id: UUID
    document_id: UUID
    document_name: str
    text_snippet: str
    chunk_index: int
    x: float
    y: float

    @classmethod
    def from_row(cls, row: UmapPointRow) -> UmapPointRead:
        """Build a schema instance from a joined point row."""
        return cls(
            id=row.point.id,
            chunk_id=row.point.chunk_id,
            document_id=row.point.document_id,
            document_name=row.document_name,
            text_snippet=row.text_snippet,
            chunk_index=row.point.chunk_index,
            x=row.point.x,
            y=row.point.y,
        )


class UmapVisualizationRead(BaseModel):
    """Response payload containing a UMAP projection and its points."""

    projection: UmapProjectionRead
    points: list[UmapPointRead]
