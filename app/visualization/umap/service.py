"""UMAP projection service for collection embeddings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple
from uuid import UUID

import numpy as np
from sqlmodel import Session
from umap import UMAP

from app.db import models
from app.visualization.umap.repository import ChunkEmbeddingRow, UmapRepository


@dataclass(frozen=True)
class UmapConfig:
    """Configuration settings for UMAP projections."""

    n_neighbors: int = 15
    min_dist: float = 0.1
    metric: str = "cosine"
    random_state: int = 42
    n_components: int = 2


class UmapService:
    """Service for computing and reading UMAP projections."""

    def __init__(self, session: Session) -> None:
        """Initialize the service with a database session."""
        self._session = session
        self._repo = UmapRepository(session)

    def get_latest_projection(
        self, collection_id: UUID
    ) -> Tuple[models.UmapProjectionRecord, List[models.UmapPointRecord]]:
        """Return the latest projection and its points for a collection."""
        projection = self._repo.get_latest_projection(collection_id)
        if projection is None:
            raise ValueError("UMAP projection not found.")
        points = self._repo.list_points(projection.id)
        return projection, points

    def compute_projection(
        self,
        user: models.User,
        collection: models.Collection,
        config: UmapConfig,
    ) -> Tuple[models.UmapProjectionRecord, List[models.UmapPointRecord]]:
        """Compute and persist a UMAP projection for a collection."""
        chunk_rows = self._repo.list_chunk_embeddings(collection.id)
        if len(chunk_rows) < 3:
            raise ValueError("At least three chunks are required to compute UMAP.")

        embeddings = [row.embedding for row in chunk_rows if row.embedding]
        if len(embeddings) != len(chunk_rows):
            raise ValueError("One or more chunks are missing embeddings.")

        dimension = len(embeddings[0]) if embeddings else 0
        if dimension == 0:
            raise ValueError("Embeddings are empty for this collection.")
        if any(len(embedding) != dimension for embedding in embeddings):
            raise ValueError("Embedding dimensions are inconsistent across chunks.")

        n_neighbors = min(config.n_neighbors, max(2, len(embeddings) - 1))
        init = "random" if len(embeddings) <= config.n_components + 1 else "spectral"
        reducer = UMAP(
            n_neighbors=n_neighbors,
            min_dist=config.min_dist,
            metric=config.metric,
            n_components=config.n_components,
            random_state=config.random_state,
            init=init,
        )
        array = np.array(embeddings, dtype=np.float32)
        coordinates = reducer.fit_transform(array)
        if not np.isfinite(coordinates).all():
            raise ValueError("UMAP produced non-finite coordinates.")

        embedding_model = chunk_rows[0].embedding_model
        self._repo.delete_collection_projections(collection.id)

        projection = models.UmapProjectionRecord(
            collection_id=collection.id,
            user_id=user.id,
            embedding_model=embedding_model,
            n_neighbors=n_neighbors,
            min_dist=config.min_dist,
            metric=config.metric,
            n_components=config.n_components,
            random_state=config.random_state,
            point_count=len(chunk_rows),
        )
        self._session.add(projection)
        self._session.flush()

        points = self._build_points(projection.id, chunk_rows, coordinates)
        self._session.add_all(points)
        self._session.flush()

        return projection, points

    @staticmethod
    def _build_points(
        projection_id: UUID,
        chunk_rows: List[ChunkEmbeddingRow],
        coordinates: np.ndarray,
    ) -> List[models.UmapPointRecord]:
        """Build point records from coordinate outputs."""
        points: List[models.UmapPointRecord] = []
        for row, coord in zip(chunk_rows, coordinates):
            points.append(
                models.UmapPointRecord(
                    projection_id=projection_id,
                    chunk_id=row.chunk_id,
                    document_id=row.document_id,
                    chunk_index=row.chunk_index,
                    x=float(coord[0]),
                    y=float(coord[1]),
                )
            )
        return points
