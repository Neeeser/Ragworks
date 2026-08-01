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
from sqlmodel import Session, col, select

from app.db import models
from app.db.repositories.insight import InsightRepository
from app.schemas.enums import InsightSpace, InsightStatus
from app.visualization.insights import engine, store
from app.visualization.insights.engine import Array
from app.visualization.insights.spaces import (
    ChunkRow,
    VectorSpace,
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
    reducer_blob, coordinates = engine.fit_projection(space.matrix)
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
            reducer_blob=reducer_blob,
            fitted_chunk_ids=list(space.chunk_ids),
            lexical_transformer=space.lexical_transformer,
        ),
    )


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


