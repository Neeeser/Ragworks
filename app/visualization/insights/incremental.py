"""Incremental placement of newly ingested chunks into a stored layout.

The counterpart to `builder.full_build`: chunks ingested since the fit are
transformed into the existing projection (existing points never move) and
booked as drift; `needs_full_rebuild` is the honesty check that decides when
the stored layout can no longer absorb additions and a refit is due.
"""

from __future__ import annotations

from uuid import UUID

import numpy as np
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, select

from app.db import models
from app.schemas.enums import InsightSpace
from app.visualization.insights import engine, store
from app.visualization.insights.builder import (
    REFIT_DRIFT_RATIO,
    _write_doc_edges,
    _write_points,
    vectors_for,
)
from app.visualization.insights.engine import Array
from app.visualization.insights.spaces import (
    ChunkRow,
    VectorSpace,
    load_chunk_rows,
    resolve_space,
)


def needs_full_rebuild(session: Session, snapshot: models.InsightSnapshotRecord) -> bool:
    """Whether the stored layout can still absorb new points honestly.

    True when drift crossed the refit threshold, the bundle is missing or
    stale, a fitted chunk no longer exists (the transform basis cannot be
    reproduced), or the collection's best space changed kind or model.
    """
    drift = snapshot.transformed_count + snapshot.deleted_count
    if drift > REFIT_DRIFT_RATIO * max(snapshot.fitted_count, 1):
        return True
    bundle = store.load_bundle(snapshot.collection_id, snapshot.id)
    if bundle is None:
        return True
    rows = load_chunk_rows(session, snapshot.collection_id)
    by_id = {row.chunk_id: row for row in rows}
    if any(chunk_id not in by_id for chunk_id in bundle.fitted_chunk_ids):
        return True
    space = resolve_space(session, snapshot.collection_id)
    return space.kind != snapshot.space or space.label != snapshot.space_label


def incremental_update(session: Session, snapshot: models.InsightSnapshotRecord) -> int:
    """Place newly ingested chunks into the stored layout; returns how many.

    Callers check `needs_full_rebuild` first; this path assumes the bundle
    is loadable and the basis reproducible, and raises otherwise (the task
    wrapper falls back to a full build).
    """
    bundle = store.load_bundle(snapshot.collection_id, snapshot.id)
    if bundle is None:
        raise ValueError("Model bundle is missing for incremental update.")
    rows = load_chunk_rows(session, snapshot.collection_id)
    by_id = {row.chunk_id: row for row in rows}
    placed = set(
        session.exec(
            select(col(models.InsightPointRecord.chunk_id)).where(
                col(models.InsightPointRecord.snapshot_id) == snapshot.id
            )
        ).all()
    )
    fresh = [row for row in rows if row.chunk_id not in placed]
    new_rows = _placeable(fresh, snapshot, bundle)
    if not new_rows:
        return 0

    basis_rows = [by_id[chunk_id] for chunk_id in bundle.fitted_chunk_ids]
    basis = vectors_for(basis_rows, snapshot, bundle)
    new_matrix = vectors_for(new_rows, snapshot, bundle)
    coordinates = engine.transform_points(bundle.reducer_blob, basis, new_matrix)

    new_space = VectorSpace(
        kind=snapshot.space,
        label=snapshot.space_label,
        chunk_ids=[row.chunk_id for row in new_rows],
        document_ids=[row.document_id for row in new_rows],
        chunk_indices=[row.chunk_index for row in new_rows],
        matrix=new_matrix,
        coverage=1.0,
        texts=[row.text for row in new_rows],
    )
    _write_points(
        session,
        snapshot.id,
        new_space,
        coordinates,
        np.full(len(new_rows), -1, dtype=np.int64),
    )
    _write_new_neighbors(session, snapshot, basis_rows, basis, new_rows, new_matrix)
    _refresh_doc_aggregates(session, snapshot, rows, bundle)

    snapshot.point_count += len(new_rows)
    snapshot.transformed_count += len(new_rows)
    snapshot.coverage = (len(placed) + len(new_rows)) / max(len(rows), 1)
    session.add(snapshot)
    session.flush()
    return len(new_rows)


def _placeable(
    fresh: list[ChunkRow],
    snapshot: models.InsightSnapshotRecord,
    bundle: store.InsightModelBundle,
) -> list[ChunkRow]:
    """Filter new chunks to those the snapshot's space can vectorize."""
    if snapshot.space == InsightSpace.LEXICAL:
        return [row for row in fresh if row.text.strip()]
    return [
        row
        for row in fresh
        if row.embedding and row.embedding_model == snapshot.space_label
    ]


def _write_new_neighbors(
    session: Session,
    snapshot: models.InsightSnapshotRecord,
    basis_rows: list[ChunkRow],
    basis: Array,
    new_rows: list[ChunkRow],
    new_matrix: Array,
) -> None:
    """kNN edges for transformed-in chunks against the whole current corpus.

    Directed from the new chunk only: an older chunk's stored top-k is not
    revisited, but the overlap report deduplicates pairs in either
    direction, so a new near-duplicate still surfaces.
    """
    all_rows = [*basis_rows, *new_rows]
    unit_all = engine.normalized(np.vstack([basis, new_matrix]))
    unit_new = engine.normalized(new_matrix)
    sims = unit_new @ unit_all.T
    k = min(engine.KNN_NEIGHBORS, len(all_rows) - 1)
    for i, row in enumerate(new_rows):
        own = len(basis_rows) + i
        order = np.argsort(sims[i])[::-1]
        kept = 0
        for target in order:
            if kept >= k:
                break
            if int(target) == own:
                continue
            other = all_rows[int(target)]
            session.add(
                models.InsightNeighborRecord(
                    snapshot_id=snapshot.id,
                    chunk_id=row.chunk_id,
                    neighbor_chunk_id=other.chunk_id,
                    document_id=row.document_id,
                    neighbor_document_id=other.document_id,
                    similarity=float(sims[i, int(target)]),
                    cross_document=row.document_id != other.document_id,
                )
            )
            kept += 1


def _refresh_doc_aggregates(
    session: Session,
    snapshot: models.InsightSnapshotRecord,
    current_rows: list[ChunkRow],
    bundle: store.InsightModelBundle,
) -> None:
    """Rebuild document points and edges after an incremental placement.

    Cheap relative to the transform itself (documents are few next to
    chunks), and rebuilding wholesale keeps one code path instead of a
    patch-in-place variant that would drift from `full_build`'s.
    """
    session.flush()
    point_rows = session.exec(
        select(models.InsightPointRecord).where(
            col(models.InsightPointRecord.snapshot_id) == snapshot.id
        )
    ).all()
    session.execute(
        sa_delete(models.InsightDocPointRecord).where(
            col(models.InsightDocPointRecord.snapshot_id) == snapshot.id
        )
    )
    session.execute(
        sa_delete(models.InsightDocEdgeRecord).where(
            col(models.InsightDocEdgeRecord.snapshot_id) == snapshot.id
        )
    )
    by_doc: dict[UUID, list[models.InsightPointRecord]] = {}
    for point in point_rows:
        by_doc.setdefault(point.document_id, []).append(point)
    for document_id, points in by_doc.items():
        session.add(
            models.InsightDocPointRecord(
                snapshot_id=snapshot.id,
                document_id=document_id,
                x=float(np.mean([p.x for p in points])),
                y=float(np.mean([p.y for p in points])),
                chunk_count=len(points),
            )
        )
    placed_ids = {point.chunk_id for point in point_rows}
    placeable = [row for row in current_rows if row.chunk_id in placed_ids]
    matrix = vectors_for(placeable, snapshot, bundle)
    doc_ids = list(dict.fromkeys(row.document_id for row in placeable))
    doc_space = VectorSpace(
        kind=snapshot.space,
        label=snapshot.space_label,
        chunk_ids=[row.chunk_id for row in placeable],
        document_ids=[row.document_id for row in placeable],
        chunk_indices=[row.chunk_index for row in placeable],
        matrix=matrix,
        coverage=1.0,
        texts=[],
    )
    _write_doc_edges(session, snapshot.id, doc_space, doc_ids)
    snapshot.document_count = len(doc_ids)
