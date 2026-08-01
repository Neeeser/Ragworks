"""Builds and incrementally updates a collection's insight snapshot.

Two paths, one contract:

- `full_build` fits everything from scratch — projection, kNN graph,
  clusters, labels, document points and edges — into a fresh snapshot that
  replaces the previous one only once it is `ready`.
- `incremental_update` places chunks ingested since the fit into the stored
  layout via the pickled reducer (existing points never move), and books the
  additions as drift. When drift crosses `REFIT_DRIFT_RATIO`, the caller
  falls back to `full_build`.
"""

from __future__ import annotations

from uuid import UUID

import numpy as np
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, select

from app.db import models
from app.db.repositories.insight import InsightRepository
from app.schemas.enums import InsightSpace, InsightStatus
from app.visualization.insights import engine, store
from app.visualization.insights.engine import Array
from app.visualization.insights.spaces import (
    ChunkRow,
    VectorSpace,
    load_chunk_rows,
    resolve_space,
)

# Fraction of the fitted layout that may be transformed-in or deleted before
# the layout is considered drifted and a full refit is scheduled.
REFIT_DRIFT_RATIO = 0.2


def full_build(session: Session, snapshot: models.InsightSnapshotRecord) -> None:
    """Fit every artifact into the given `computing` snapshot and mark it ready.

    The snapshot row already exists (committed by the scheduler as the
    page's progress signal); this fills it. On success the collection's
    older snapshots are deleted in the same transaction — the atomic swap.
    """
    space = resolve_space(session, snapshot.collection_id)
    knn = engine.knn_graph(space.matrix)
    reducer, coordinates = engine.fit_projection(space.matrix)
    cluster_labels = engine.cluster_points(coordinates)
    label_names = engine.label_clusters(space.texts, cluster_labels)

    _write_points(session, snapshot.id, space, coordinates, cluster_labels)
    _write_clusters(session, snapshot.id, cluster_labels, label_names, coordinates)
    _write_neighbors(session, snapshot.id, space, knn)
    doc_ids = _write_doc_points(session, snapshot.id, space, coordinates)
    _write_doc_edges(session, snapshot.id, space, doc_ids)

    repo = InsightRepository(session)
    for other in _other_snapshots(session, snapshot):
        repo.delete_snapshot(other)

    snapshot.space = space.kind
    snapshot.space_label = space.label
    snapshot.status = InsightStatus.READY
    snapshot.error_message = None
    snapshot.point_count = len(space.chunk_ids)
    snapshot.fitted_count = len(space.chunk_ids)
    snapshot.document_count = len(doc_ids)
    snapshot.cluster_count = len(label_names)
    snapshot.coverage = space.coverage
    snapshot.transformed_count = 0
    snapshot.deleted_count = 0
    session.add(snapshot)
    session.flush()

    store.save_bundle(
        snapshot.collection_id,
        store.InsightModelBundle(
            snapshot_id=snapshot.id,
            space=space.kind,
            reducer=reducer,
            fitted_chunk_ids=list(space.chunk_ids),
            lexical_transformer=space.lexical_transformer,
        ),
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
    coordinates = engine.transform_points(bundle.reducer, basis, new_matrix)

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


def vectors_for(
    rows: list[ChunkRow],
    snapshot: models.InsightSnapshotRecord,
    bundle: store.InsightModelBundle,
) -> Array:
    """Vectorize rows in the snapshot's space, preserving row order."""
    if snapshot.space == InsightSpace.LEXICAL:
        if bundle.lexical_transformer is None:
            raise ValueError("Lexical bundle is missing its transformer.")
        return np.asarray(
            bundle.lexical_transformer.transform([row.text for row in rows]),
            dtype=np.float32,
        )
    return np.array([row.embedding for row in rows], dtype=np.float32)


def _other_snapshots(
    session: Session, snapshot: models.InsightSnapshotRecord
) -> list[UUID]:
    ids = session.exec(
        select(col(models.InsightSnapshotRecord.id)).where(
            col(models.InsightSnapshotRecord.collection_id) == snapshot.collection_id,
            col(models.InsightSnapshotRecord.id) != snapshot.id,
        )
    ).all()
    return list(ids)


def _write_points(
    session: Session,
    snapshot_id: UUID,
    space: VectorSpace,
    coordinates: Array,
    cluster_labels: Array,
) -> None:
    for i, chunk_id in enumerate(space.chunk_ids):
        label = int(cluster_labels[i])
        session.add(
            models.InsightPointRecord(
                snapshot_id=snapshot_id,
                chunk_id=chunk_id,
                document_id=space.document_ids[i],
                chunk_index=space.chunk_indices[i],
                x=float(coordinates[i, 0]),
                y=float(coordinates[i, 1]),
                cluster_index=label if label >= 0 else None,
            )
        )


def _write_clusters(
    session: Session,
    snapshot_id: UUID,
    cluster_labels: Array,
    label_names: dict[int, str],
    coordinates: Array,
) -> None:
    for cluster_index, label in label_names.items():
        member_mask = cluster_labels == cluster_index
        centroid = coordinates[member_mask].mean(axis=0)
        session.add(
            models.InsightClusterRecord(
                snapshot_id=snapshot_id,
                cluster_index=cluster_index,
                label=label,
                size=int(member_mask.sum()),
                x=float(centroid[0]),
                y=float(centroid[1]),
            )
        )


def _write_neighbors(
    session: Session, snapshot_id: UUID, space: VectorSpace, knn: engine.KnnGraph
) -> None:
    for i in range(knn.indices.shape[0]):
        for j in range(knn.indices.shape[1]):
            neighbor = int(knn.indices[i, j])
            session.add(
                models.InsightNeighborRecord(
                    snapshot_id=snapshot_id,
                    chunk_id=space.chunk_ids[i],
                    neighbor_chunk_id=space.chunk_ids[neighbor],
                    document_id=space.document_ids[i],
                    neighbor_document_id=space.document_ids[neighbor],
                    similarity=float(knn.similarities[i, j]),
                    cross_document=space.document_ids[i] != space.document_ids[neighbor],
                )
            )


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


def _write_doc_points(
    session: Session, snapshot_id: UUID, space: VectorSpace, coordinates: Array
) -> list[UUID]:
    """One aggregate point per document: the mean of its chunk positions."""
    by_doc: dict[UUID, list[int]] = {}
    for i, document_id in enumerate(space.document_ids):
        by_doc.setdefault(document_id, []).append(i)
    for document_id, indices in by_doc.items():
        member = coordinates[indices]
        session.add(
            models.InsightDocPointRecord(
                snapshot_id=snapshot_id,
                document_id=document_id,
                x=float(member[:, 0].mean()),
                y=float(member[:, 1].mean()),
                chunk_count=len(indices),
            )
        )
    return list(by_doc.keys())


def _write_doc_edges(
    session: Session, snapshot_id: UUID, space: VectorSpace, doc_ids: list[UUID]
) -> None:
    """Document graph edges from high-dim centroid similarity."""
    index_of = {document_id: i for i, document_id in enumerate(doc_ids)}
    sums = np.zeros((len(doc_ids), space.matrix.shape[1]), dtype=np.float64)
    counts = np.zeros(len(doc_ids), dtype=np.int64)
    for i, document_id in enumerate(space.document_ids):
        row = index_of[document_id]
        sums[row] += space.matrix[i]
        counts[row] += 1
    centroids = (sums / np.maximum(counts[:, None], 1)).astype(np.float32)
    collisions = _collision_counts(session, snapshot_id)
    for edge in engine.doc_edges(centroids):
        source_id = doc_ids[edge.source]
        target_id = doc_ids[edge.target]
        key = (min(source_id, target_id), max(source_id, target_id))
        session.add(
            models.InsightDocEdgeRecord(
                snapshot_id=snapshot_id,
                source_document_id=source_id,
                target_document_id=target_id,
                similarity=edge.similarity,
                collision_count=collisions.get(key, 0),
            )
        )


def _collision_counts(session: Session, snapshot_id: UUID) -> dict[tuple[UUID, UUID], int]:
    """Cross-document near-duplicate pair counts, keyed by document pair."""
    rows = session.exec(
        select(
            col(models.InsightNeighborRecord.document_id),
            col(models.InsightNeighborRecord.neighbor_document_id),
            col(models.InsightNeighborRecord.chunk_id),
            col(models.InsightNeighborRecord.neighbor_chunk_id),
        ).where(
            col(models.InsightNeighborRecord.snapshot_id) == snapshot_id,
            col(models.InsightNeighborRecord.cross_document).is_(True),
            col(models.InsightNeighborRecord.similarity) >= engine.OVERLAP_SIMILARITY,
        )
    ).all()
    pairs: set[tuple[UUID, UUID, UUID, UUID]] = set()
    for doc_a, doc_b, chunk_a, chunk_b in rows:
        doc_key = (min(doc_a, doc_b), max(doc_a, doc_b))
        chunk_key = (min(chunk_a, chunk_b), max(chunk_a, chunk_b))
        pairs.add((*doc_key, *chunk_key))
    counts: dict[tuple[UUID, UUID], int] = {}
    for doc_a, doc_b, _chunk_a, _chunk_b in pairs:
        counts[(doc_a, doc_b)] = counts.get((doc_a, doc_b), 0) + 1
    return counts


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
