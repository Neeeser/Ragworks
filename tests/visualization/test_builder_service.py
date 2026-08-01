"""Lifecycle tests: full build, incremental placement, drift, and purge.

PaCMAP itself is exercised in `test_engine.py`; here the projection seam
(`engine.fit_projection` / `engine.transform_points` — our wrapper around
the third-party fitter) is stubbed with a deterministic planar projection so
lifecycle behavior is fast and exact.
"""

from __future__ import annotations

import numpy as np
import pytest
from sqlmodel import Session, col, select

from app.db import models
from app.db.repositories import ChunkRepository
from app.db.repositories.insight import InsightRepository
from app.schemas.enums import InsightSpace, InsightStatus
from app.visualization.insights import builder, engine, incremental, store
from app.visualization.insights.service import InsightService
from tests.visualization.conftest import add_document


@pytest.fixture(autouse=True)
def _stub_projection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        engine,
        "fit_projection",
        lambda matrix, random_state=42: (
            b"planar-reducer",
            np.asarray(matrix[:, :2], dtype=np.float64),
        ),
    )
    monkeypatch.setattr(
        engine,
        "transform_points",
        lambda reducer_blob, basis, new: np.asarray(new[:, :2], dtype=np.float64),
    )


def _seed_two_documents(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    add_document(
        session,
        collection,
        user,
        "faq-v1.txt",
        [
            ("refund window is thirty days", [1.0, 0.0, 0.0]),
            ("shipping takes five days", [0.8, 0.2, 0.0]),
        ],
    )
    add_document(
        session,
        collection,
        user,
        "faq-v2.txt",
        [
            ("refund window is thirty days", [1.0, 0.0, 0.0]),
            ("support email response times", [0.0, 1.0, 0.0]),
        ],
    )


def _refresh(session: Session, collection: models.Collection, user: models.User) -> None:
    service = InsightService(session)
    marker = service.begin_refresh(collection.id, user.id)
    assert marker is not None
    service.run_refresh(marker)


def test_full_build_produces_ready_snapshot_with_artifacts(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    _seed_two_documents(session, collection, user)
    _refresh(session, collection, user)

    with Session(session.get_bind()) as fresh:
        snapshot = InsightRepository(fresh).get_ready_snapshot(collection.id)
        assert snapshot is not None
        assert snapshot.status == InsightStatus.READY
        assert snapshot.space == InsightSpace.SEMANTIC
        assert snapshot.space_label == "test-embed"
        assert snapshot.point_count == 4
        assert snapshot.fitted_count == 4
        assert snapshot.document_count == 2
        points = InsightRepository(fresh).list_points(snapshot.id)
        assert len(points) == 4
        doc_points = InsightRepository(fresh).list_doc_points(snapshot.id)
        assert len(doc_points) == 2
        neighbors = fresh.exec(
            select(models.InsightNeighborRecord).where(
                col(models.InsightNeighborRecord.snapshot_id) == snapshot.id
            )
        ).all()
        assert neighbors
        assert store.load_bundle(collection.id, snapshot.id) is not None


def test_overlap_report_names_the_cross_document_duplicate_once(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    """The identical chunk shared by both documents is the top overlap, and
    the pair appears once despite directed edges both ways."""
    _seed_two_documents(session, collection, user)
    _refresh(session, collection, user)

    with Session(session.get_bind()) as fresh:
        service = InsightService(fresh)
        snapshot = service.ready_snapshot(collection.id)
        pairs, total = service.overlaps(snapshot, limit=10)
        assert pairs
        top = pairs[0]
        assert top.neighbor.similarity == pytest.approx(1.0, abs=1e-5)
        assert {top.document_name, top.neighbor_document_name} == {
            "faq-v1.txt",
            "faq-v2.txt",
        }
        keys = {
            tuple(sorted((row.neighbor.chunk_id, row.neighbor.neighbor_chunk_id)))
            for row in pairs
        }
        assert len(keys) == len(pairs)
        assert total == len(pairs)


def test_incremental_update_places_new_chunks_without_refitting(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    _seed_two_documents(session, collection, user)
    _refresh(session, collection, user)
    first = InsightService(session).ready_snapshot(collection.id)
    first_id = first.id
    original = {
        point.chunk_id: (point.x, point.y)
        for point, _ in InsightRepository(session).list_points(first_id)
    }

    add_document(
        session,
        collection,
        user,
        "later.txt",
        [("new content arriving later", [0.5, 0.5, 0.0])],
    )
    _refresh(session, collection, user)

    with Session(session.get_bind()) as fresh:
        snapshot = InsightRepository(fresh).get_ready_snapshot(collection.id)
        assert snapshot is not None
        assert snapshot.id == first_id  # same layout, not a refit
        assert snapshot.point_count == 5
        assert snapshot.transformed_count == 1
        points = InsightRepository(fresh).list_points(snapshot.id)
        assert len(points) == 5
        for point, _name in points:
            if point.chunk_id in original:
                assert (point.x, point.y) == pytest.approx(original[point.chunk_id])
        # Exactly one non-ready snapshot never survives a finished refresh.
        all_rows = fresh.exec(
            select(models.InsightSnapshotRecord).where(
                col(models.InsightSnapshotRecord.collection_id) == collection.id
            )
        ).all()
        assert len(all_rows) == 1


def test_drift_past_threshold_forces_a_full_refit(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    _seed_two_documents(session, collection, user)
    _refresh(session, collection, user)
    snapshot = InsightService(session).ready_snapshot(collection.id)
    first_id = snapshot.id
    snapshot.transformed_count = snapshot.fitted_count  # way past 20%
    session.add(snapshot)
    session.commit()

    assert incremental.needs_full_rebuild(session, snapshot) is True
    _refresh(session, collection, user)

    with Session(session.get_bind()) as fresh:
        rebuilt = InsightRepository(fresh).get_ready_snapshot(collection.id)
        assert rebuilt is not None
        assert rebuilt.id != first_id
        assert rebuilt.transformed_count == 0


def test_chunk_purge_removes_points_and_books_drift(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    _seed_two_documents(session, collection, user)
    _refresh(session, collection, user)
    snapshot = InsightService(session).ready_snapshot(collection.id)
    doomed = session.exec(
        select(models.Document).where(col(models.Document.name) == "faq-v2.txt")
    ).one()

    ChunkRepository(session).delete_for_document(doomed.id)
    session.commit()

    with Session(session.get_bind()) as fresh:
        reloaded = fresh.get(models.InsightSnapshotRecord, snapshot.id)
        assert reloaded is not None
        assert reloaded.deleted_count == 2
        assert reloaded.point_count == 2
        remaining = InsightRepository(fresh).list_points(snapshot.id)
        assert {name for _, name in remaining} == {"faq-v1.txt"}
        stale_neighbors = fresh.exec(
            select(models.InsightNeighborRecord).where(
                col(models.InsightNeighborRecord.neighbor_document_id) == doomed.id
            )
        ).all()
        assert stale_neighbors == []


def test_space_flip_triggers_full_rebuild(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    """A collection whose first embedded chunks arrive after a lexical build
    must refit into the semantic space rather than transforming into it."""
    add_document(
        session,
        collection,
        user,
        "text-only.txt",
        [("alpha beta gamma", []), ("delta epsilon zeta", []), ("eta theta iota", [])],
    )
    _refresh(session, collection, user)
    snapshot = InsightService(session).ready_snapshot(collection.id)
    assert snapshot.space == InsightSpace.LEXICAL

    add_document(
        session,
        collection,
        user,
        "embedded.txt",
        [("k", [1.0, 0.0]), ("l", [0.0, 1.0]), ("m", [1.0, 1.0])],
    )
    assert incremental.needs_full_rebuild(session, snapshot) is True
    _refresh(session, collection, user)
    rebuilt = InsightService(session).ready_snapshot(collection.id)
    assert rebuilt.space == InsightSpace.SEMANTIC


def test_failed_compute_records_error_on_marker(
    session: Session,
    collection: models.Collection,
    user: models.User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_two_documents(session, collection, user)
    service = InsightService(session)
    marker = service.begin_refresh(collection.id, user.id)
    assert marker is not None

    def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("fit exploded")

    monkeypatch.setattr(builder, "full_build", boom)
    with pytest.raises(RuntimeError):
        service.run_refresh(marker)
    service.mark_failed(marker.id, RuntimeError("fit exploded"))

    with Session(session.get_bind()) as fresh:
        row = fresh.get(models.InsightSnapshotRecord, marker.id)
        assert row is not None
        assert row.status == InsightStatus.FAILED
        assert row.error_message == "fit exploded"
