"""Thin-route tests for the collections module.

Creation/update/prompt behavior lives in ``tests/services/test_collections.py``
and the deletion cascade in ``tests/services/test_collection_deletion.py``; the
cross-cutting 401/404/422 contract lives in ``tests/api/test_route_contract.py``.
What remains here is the route+repository integration that isn't a pure service
concern: the 404 guard and the stats aggregation shaped for the wire.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import collections as collections_routes
from app.db import models
from app.db.repositories import CollectionRepository, UserRepository
from app.schemas.enums import StatsHistoryRange


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_get_collection_and_prompt_missing_return_404(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection_prompt(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_get_collection_returns_schema(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    fetched = collections_routes.get_collection(collection.id, current_user=user, session=session)

    assert fetched.id == collection.id
    assert fetched.metadata == {}


def test_collection_stats_include_query_latency(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    session.add_all(
        [
            models.Document(
                collection_id=collection.id,
                user_id=user.id,
                name=f"doc-{suffix}.txt",
                content_type="text/plain",
                status=models.DocumentStatus.READY,
                num_chunks=chunks,
                num_tokens=tokens,
                chunk_size=128,
                chunk_overlap=8,
                chunk_strategy=models.ChunkStrategy.TOKEN,
                embedding_model="embed-model",
            )
            for suffix, chunks, tokens in (("a", 3, 120), ("b", 5, 240))
        ]
    )
    session.add_all(
        [
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text=text,
                top_k=3,
                model="embed-model",
                context_tokens=12,
                latency_ms=latency,
                response_payload={"match_count": 3},
            )
            for text, latency in (("query a", 120.0), ("query b", 180.0))
        ]
    )
    session.commit()

    stats = collections_routes.get_collection_stats(
        collection.id, current_user=user, session=session
    )
    assert stats.document_count == 2
    assert stats.chunk_count == 8
    assert stats.average_latency_ms == pytest.approx(150.0, rel=1e-3)
    assert stats.last_used_at is not None

    stats_list = collections_routes.list_collection_stats(current_user=user, session=session)
    stats_map = {entry.collection_id: entry for entry in stats_list}
    assert stats_map[collection.id].chunk_count == 8


def _make_document(
    collection: models.Collection,
    user: models.User,
    name: str,
    num_chunks: int,
    created_at: datetime,
) -> models.Document:
    return models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name=name,
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=num_chunks,
        num_tokens=num_chunks * 40,
        chunk_size=128,
        chunk_overlap=8,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed-model",
        created_at=created_at,
    )


def test_stats_history_buckets_growth_and_latency(session: Session) -> None:
    """History points carry cumulative totals, per-day latency, and gap fill."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    today = datetime.now(UTC).replace(tzinfo=None, hour=12)

    session.add_all(
        [
            # Before the window: seeds the cumulative baseline.
            _make_document(collection, user, "old.txt", 4, today - timedelta(days=20)),
            # Inside the window, two days ago and today.
            _make_document(collection, user, "recent.txt", 3, today - timedelta(days=2)),
            _make_document(collection, user, "new.txt", 5, today),
        ]
    )
    session.add_all(
        [
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text="q",
                top_k=3,
                model="embed-model",
                context_tokens=12,
                latency_ms=latency,
                response_payload={},
                created_at=today,
            )
            for latency in (100.0, 200.0, 300.0)
        ]
    )
    pipeline = models.Pipeline(
        user_id=user.id, name="ingest", kind=models.PipelineKind.INGESTION
    )
    session.add(pipeline)
    session.commit()
    session.add(
        models.PipelineRun(
            pipeline_id=pipeline.id,
            kind=models.PipelineKind.INGESTION,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.COMPLETED,
            started_at=today - timedelta(days=2),
            completed_at=today - timedelta(days=2) + timedelta(milliseconds=1500),
            created_at=today - timedelta(days=2),
        )
    )
    # A still-running run must not contribute a latency sample.
    session.add(
        models.PipelineRun(
            pipeline_id=pipeline.id,
            kind=models.PipelineKind.INGESTION,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.RUNNING,
            started_at=today,
            created_at=today,
        )
    )
    session.commit()

    history = collections_routes.get_collection_stats_history(
        collection.id,
        range_=StatsHistoryRange.DAYS_7,
        current_user=user,
        session=session,
    )

    assert history.range == StatsHistoryRange.DAYS_7
    assert history.bucket == "day"
    assert len(history.points) == 7
    assert all(
        point.bucket_start.hour == 0 and point.bucket_start.minute == 0
        for point in history.points
    )
    first, two_days_ago, last = history.points[0], history.points[4], history.points[-1]
    # Baseline document predates the window.
    assert (first.document_total, first.chunk_total) == (1, 4)
    assert (two_days_ago.document_total, two_days_ago.chunk_total) == (2, 7)
    assert (last.document_total, last.chunk_total) == (3, 12)
    # Gap days still exist and carry totals forward.
    assert history.points[5].document_total == 2

    assert last.retrieval.count == 3
    assert last.retrieval.avg_ms == pytest.approx(200.0)
    assert last.retrieval.p50_ms == pytest.approx(200.0)
    assert last.retrieval.p95_ms == pytest.approx(290.0)
    assert last.retrieval.max_ms == pytest.approx(300.0)

    assert two_days_ago.ingestion.count == 1
    assert two_days_ago.ingestion.avg_ms == pytest.approx(1500.0, rel=1e-2)
    # The RUNNING run today contributed nothing.
    assert last.ingestion.count == 0
    assert last.ingestion.avg_ms is None


def test_stats_history_missing_collection_returns_404(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection_stats_history(
            uuid4(),
            range_=StatsHistoryRange.DAYS_30,
            current_user=user,
            session=session,
        )
    assert excinfo.value.status_code == 404


def test_stats_history_hourly_ranges_bucket_by_hour(session: Session) -> None:
    """4h/24h ranges return hour buckets aligned to the clock, not days."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None)

    session.add_all(
        [
            _make_document(collection, user, "older.txt", 2, now - timedelta(hours=3)),
            _make_document(collection, user, "fresh.txt", 4, now),
        ]
    )
    session.add(
        models.QueryEvent(
            user_id=user.id,
            collection_id=collection.id,
            query_text="q",
            top_k=3,
            model="embed-model",
            context_tokens=12,
            latency_ms=250.0,
            response_payload={},
            created_at=now - timedelta(hours=1),
        )
    )
    session.commit()

    history = collections_routes.get_collection_stats_history(
        collection.id,
        range_=StatsHistoryRange.HOURS_4,
        current_user=user,
        session=session,
    )

    assert history.bucket == "hour"
    assert len(history.points) == 4
    steps = [
        (later.bucket_start - earlier.bucket_start).total_seconds()
        for earlier, later in zip(history.points, history.points[1:], strict=False)
    ]
    assert steps == [3600.0, 3600.0, 3600.0]
    # The 3-hours-ago document lands in the oldest bucket; the fresh one in the last.
    assert (history.points[0].document_total, history.points[0].chunk_total) == (1, 2)
    assert (history.points[-1].document_total, history.points[-1].chunk_total) == (2, 6)
    # The query an hour ago sits in its own hour bucket, not the latest.
    assert history.points[2].retrieval.count == 1
    assert history.points[2].retrieval.avg_ms == pytest.approx(250.0)
    assert history.points[-1].retrieval.count == 0
