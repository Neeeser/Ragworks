"""Read/refresh surface for collection insights.

The service owns snapshot lifecycle decisions (what refresh means right now:
first build, incremental placement, or drift-forced refit) and the read
methods the routes translate onto the wire. Heavy math lives in `engine`,
row writing in `builder`, scheduling in `tasks`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import numpy as np
from sqlmodel import Session, col, func, select

from app.db import models
from app.db.repositories.insight import InsightRepository, OverlapPairRow
from app.schemas.enums import InsightSpace, InsightStatus
from app.services.errors import InvalidInputError, NotFoundError
from app.visualization.insights import builder, engine, incremental, store
from app.visualization.insights.engine import Array
from app.visualization.insights.spaces import load_chunk_rows

# A `computing` row older than this is a crashed worker, not progress; the
# overview reports it failed and refresh is allowed to start over.
STALE_COMPUTING = timedelta(minutes=15)

PROBE_TOP_K = 10


class InsightService:
    """Snapshot lifecycle and read access for one collection's insights."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a session."""
        self._session = session
        self._repo = InsightRepository(session)

    # -- reads ------------------------------------------------------------

    def overview(
        self, collection_id: UUID
    ) -> tuple[models.InsightSnapshotRecord | None, models.InsightSnapshotRecord | None]:
        """Return (ready snapshot, in-flight/failed snapshot) for the page.

        A `computing` row that outlived `STALE_COMPUTING` is reported as
        failed — the worker died without recording its outcome.
        """
        ready = self._repo.get_ready_snapshot(collection_id)
        latest = self._repo.get_snapshot(collection_id)
        active = latest if latest is not None and latest.status != InsightStatus.READY else None
        if active is not None and self._is_stale(active):
            active.status = InsightStatus.FAILED
            active.error_message = "Computation did not finish; it can be retried."
        return ready, active

    def chunk_total(self, collection_id: UUID) -> int:
        """How many chunks the collection currently holds."""
        count = self._session.exec(
            select(func.count(col(models.DocumentChunkRecord.id))).where(
                col(models.DocumentChunkRecord.collection_id) == collection_id
            )
        ).one()
        return int(count)

    def ready_snapshot(self, collection_id: UUID) -> models.InsightSnapshotRecord:
        """The snapshot the data views read; 404 when none exists yet."""
        snapshot = self._repo.get_ready_snapshot(collection_id)
        if snapshot is None:
            raise NotFoundError("No insight snapshot is available yet.")
        return snapshot

    def map_data(
        self, snapshot: models.InsightSnapshotRecord
    ) -> tuple[
        list[tuple[models.InsightPointRecord, str]],
        list[tuple[models.InsightDocPointRecord, str]],
        list[models.InsightClusterRecord],
    ]:
        """Points, document points, and clusters for the map view."""
        return (
            self._repo.list_points(snapshot.id),
            self._repo.list_doc_points(snapshot.id),
            self._repo.list_clusters(snapshot.id),
        )

    def graph_data(
        self, snapshot: models.InsightSnapshotRecord
    ) -> tuple[
        list[tuple[models.InsightDocPointRecord, str]],
        list[models.InsightDocEdgeRecord],
    ]:
        """Document nodes and similarity edges for the graph view."""
        return (
            self._repo.list_doc_points(snapshot.id),
            self._repo.list_doc_edges(snapshot.id),
        )

    def overlaps(
        self, snapshot: models.InsightSnapshotRecord, limit: int
    ) -> list[OverlapPairRow]:
        """Strongest cross-document chunk pairs, the confusability report."""
        return self._repo.list_overlaps(snapshot.id, limit)

    # -- refresh ----------------------------------------------------------

    def can_compute(self, collection_id: UUID) -> bool:
        """Whether the collection has enough chunks for any space."""
        return self.chunk_total(collection_id) >= 3

    def begin_refresh(
        self, collection_id: UUID, user_id: UUID
    ) -> models.InsightSnapshotRecord | None:
        """Create and commit the `computing` marker row, or None if one runs.

        Committed before compute starts so every reader (and every other
        process) sees the work in flight; the worker fills or fails it.
        """
        latest = self._repo.get_snapshot(collection_id)
        if (
            latest is not None
            and latest.status == InsightStatus.COMPUTING
            and not self._is_stale(latest)
        ):
            return None
        collection = self._session.get(models.Collection, collection_id)
        if collection is None:
            raise NotFoundError("Collection not found.")
        snapshot = models.InsightSnapshotRecord(
            collection_id=collection_id,
            user_id=user_id,
            # Provisional until the worker resolves the space; readers only
            # consume these fields from `ready` snapshots.
            space=InsightSpace.LEXICAL,
            space_label="",
            status=InsightStatus.COMPUTING,
        )
        self._session.add(snapshot)
        self._session.commit()
        return snapshot

    def run_refresh(self, snapshot: models.InsightSnapshotRecord) -> None:
        """Fill a `computing` snapshot: incremental when honest, else refit.

        The common post-ingest path updates the existing ready snapshot in
        place (new points transformed in, doc aggregates rebuilt) and
        deletes the marker row; a full build fills the marker row and
        deletes the old snapshot. Either way exactly one snapshot survives.
        """
        ready = self._repo.get_ready_snapshot(snapshot.collection_id)
        if ready is not None and not incremental.needs_full_rebuild(self._session, ready):
            incremental.incremental_update(self._session, ready)
            ready.updated_at = datetime.now(UTC)
            self._session.add(ready)
            self._repo.delete_snapshot(snapshot.id)
            self._session.commit()
            return
        builder.full_build(self._session, snapshot)
        self._session.commit()

    def mark_failed(self, snapshot_id: UUID, error: Exception) -> None:
        """Record a failed computation on the marker row."""
        snapshot = self._session.get(models.InsightSnapshotRecord, snapshot_id)
        if snapshot is None:
            return
        snapshot.status = InsightStatus.FAILED
        snapshot.error_message = str(error) or error.__class__.__name__
        self._session.add(snapshot)
        self._session.commit()

    # -- probe ------------------------------------------------------------

    def probe(
        self,
        snapshot: models.InsightSnapshotRecord,
        query_vector: Array,
    ) -> tuple[float, float, list[tuple[UUID, float]]]:
        """Project a query vector onto the map and rank nearest chunks.

        Returns the query's 2D position and the top chunks by exact cosine
        similarity in the snapshot's space. The caller supplies the vector
        (embedded upstream for semantic spaces; the lexical path uses
        `lexical_probe_vector`).
        """
        bundle = store.load_bundle(snapshot.collection_id, snapshot.id)
        if bundle is None:
            raise InvalidInputError(
                "The projection model is unavailable; refresh the insights first."
            )
        rows = load_chunk_rows(session=self._session, collection_id=snapshot.collection_id)
        by_id = {row.chunk_id: row for row in rows}
        try:
            basis_rows = [by_id[chunk_id] for chunk_id in bundle.fitted_chunk_ids]
        except KeyError as exc:
            raise InvalidInputError(
                "The projection no longer matches the corpus; refresh the insights."
            ) from exc
        basis = builder.vectors_for(basis_rows, snapshot, bundle)
        query = np.asarray(query_vector, dtype=np.float32).reshape(1, -1)
        if query.shape[1] != basis.shape[1]:
            raise InvalidInputError(
                "The query vector's dimension does not match the projection space."
            )
        coordinates = engine.transform_points(bundle.reducer_blob, basis, query)
        sims = (engine.normalized(basis) @ engine.normalized(query).T).ravel()
        order = np.argsort(sims)[::-1][:PROBE_TOP_K]
        ranked = [(basis_rows[int(i)].chunk_id, float(sims[int(i)])) for i in order]
        return float(coordinates[0, 0]), float(coordinates[0, 1]), ranked

    def lexical_probe_vector(
        self, snapshot: models.InsightSnapshotRecord, query: str
    ) -> Array:
        """Vectorize a probe query through the snapshot's lexical transformer."""
        bundle = store.load_bundle(snapshot.collection_id, snapshot.id)
        if bundle is None or bundle.lexical_transformer is None:
            raise InvalidInputError(
                "The lexical model is unavailable; refresh the insights first."
            )
        return np.asarray(
            bundle.lexical_transformer.transform([query]), dtype=np.float32
        ).ravel()

    # -- internals --------------------------------------------------------

    @staticmethod
    def _is_stale(snapshot: models.InsightSnapshotRecord) -> bool:
        updated = snapshot.updated_at
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=UTC)
        return (
            snapshot.status == InsightStatus.COMPUTING
            and datetime.now(UTC) - updated > STALE_COMPUTING
        )
