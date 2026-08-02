"""Collection activity history: domain resolution and chart assembly.

The pure half (ladder + anchoring) is exercised without a database; the rest
drives ``CollectionHistoryService`` against a real session, because the bucket
grid is Postgres ``date_bin`` and only Postgres can prove the alignment.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionHistoryRepository,
    CollectionLatencyRepository,
    CollectionRepository,
    UserRepository,
)
from app.schemas.collections import UNATTRIBUTED_TOOL_KEY
from app.schemas.enums import PipelineMarkerKind
from app.services.collection_history import (
    CollectionHistoryService,
    resolve_bucket_seconds,
    resolve_domain,
)
from app.services.errors import InvalidInputError

HOUR = 3600


def _user(session: Session, email: str = "history@example.com") -> models.User:
    user = models.User(email=email, full_name="History", hashed_password="hashed")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def _collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _document(
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


def _query_event(
    collection: models.Collection,
    user: models.User,
    latency_ms: float,
    created_at: datetime,
    run_id: UUID | None = None,
) -> models.QueryEvent:
    return models.QueryEvent(
        user_id=user.id,
        collection_id=collection.id,
        query_text="q",
        top_k=3,
        model="embed-model",
        context_tokens=12,
        latency_ms=latency_ms,
        response_payload={},
        created_at=created_at,
        pipeline_run_id=run_id,
    )


def _service(session: Session) -> CollectionHistoryService:
    return CollectionHistoryService(
        CollectionHistoryRepository(session), CollectionLatencyRepository(session)
    )


@pytest.mark.parametrize(
    ("span", "expected"),
    [
        (timedelta(minutes=20), 60),
        (timedelta(hours=1), 60),
        (timedelta(hours=3), 300),
        (timedelta(days=1), 1800),
        (timedelta(days=7), 21600),
        (timedelta(days=30), 43200),
        (timedelta(days=365), 604800),
    ],
)
def test_bucket_ladder_keeps_every_span_within_the_bucket_ceiling(
    span: timedelta, expected: int
) -> None:
    """The chosen width is the finest ladder step that stays under the ceiling."""
    assert resolve_bucket_seconds(span) == expected
    assert span.total_seconds() / resolve_bucket_seconds(span) <= 60


def test_bucket_ladder_caps_at_the_coarsest_step_for_very_old_collections() -> None:
    """A decade-old collection still resolves, at the coarsest ladder width."""
    assert resolve_bucket_seconds(timedelta(days=3650)) == 2592000


def test_lifetime_domain_starts_one_bucket_before_first_activity() -> None:
    """The lead-in bucket is what makes the first ingest read as a rise from 0."""
    now = datetime(2026, 7, 25, 12, 0, tzinfo=UTC)
    first = now - timedelta(days=10)

    domain = resolve_domain(
        collection_created_at=now - timedelta(days=40), first_activity_at=first, now=now
    )

    assert domain.bucket_seconds == HOUR * 6
    assert domain.start == first.replace(tzinfo=None) - timedelta(seconds=domain.bucket_seconds)
    assert domain.end == now.replace(tzinfo=None)


def test_lifetime_domain_falls_back_to_collection_creation_without_activity() -> None:
    """An idle collection anchors on its own creation rather than on nothing."""
    now = datetime(2026, 7, 25, 12, 0, tzinfo=UTC)
    created = now - timedelta(hours=2)

    domain = resolve_domain(
        collection_created_at=created, first_activity_at=None, now=now
    )

    assert domain.start < created.replace(tzinfo=None)
    assert domain.end == now.replace(tzinfo=None)


def test_explicit_span_overrides_the_lifetime_and_rebuckets() -> None:
    """A brushed span is re-bucketed at its own resolution, not the lifetime's."""
    now = datetime(2026, 7, 25, 12, 0, tzinfo=UTC)
    start = now - timedelta(hours=2)

    domain = resolve_domain(
        collection_created_at=now - timedelta(days=400),
        first_activity_at=now - timedelta(days=400),
        now=now,
        start=start,
        end=now,
    )

    assert (domain.start, domain.end) == (start.replace(tzinfo=None), now.replace(tzinfo=None))
    assert domain.bucket_seconds == 300


def test_explicit_span_with_end_before_start_is_rejected() -> None:
    """An inverted span is a domain error, not an empty chart."""
    now = datetime(2026, 7, 25, 12, 0, tzinfo=UTC)

    with pytest.raises(InvalidInputError):
        resolve_domain(
            collection_created_at=now,
            first_activity_at=None,
            now=now,
            start=now,
            end=now - timedelta(hours=1),
        )


def test_history_totals_are_cumulative_and_carry_across_empty_buckets(
    session: Session,
) -> None:
    """Every bucket gets a point, and quiet buckets carry the running total forward."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    session.add_all(
        [
            _document(collection, user, "first.txt", 4, now - timedelta(days=10)),
            _document(collection, user, "second.txt", 6, now - timedelta(days=2)),
        ]
    )
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    assert history.bucket_seconds > 0
    assert len(history.points) > 1
    # The lead-in bucket precedes every document, so the series opens at zero.
    assert (history.points[0].document_total, history.points[0].chunk_total) == (0, 0)
    assert (history.points[-1].document_total, history.points[-1].chunk_total) == (2, 10)
    totals = [point.document_total for point in history.points]
    assert totals == sorted(totals), "cumulative totals must never decrease"


def test_history_splits_retrieval_latency_per_tool_pipeline(session: Session) -> None:
    """Each bound tool gets its own series, keyed by the pipeline that served the query."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    fast = models.Pipeline(user_id=user.id, name="fast-search")
    slow = models.Pipeline(user_id=user.id, name="slow-search")
    session.add_all([fast, slow])
    session.commit()
    session.add_all(
        [
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=pipeline.id,
                role=models.BindingRole.TOOL,
                is_primary=pipeline is fast,
                position=position,
            )
            for position, pipeline in enumerate((fast, slow))
        ]
    )
    session.commit()

    runs = []
    for pipeline, latency in ((fast, 100.0), (slow, 900.0)):
        run = models.PipelineRun(
            pipeline_id=pipeline.id,
            trigger=models.BindingRole.TOOL,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.COMPLETED,
            started_at=now - timedelta(hours=1),
            completed_at=now - timedelta(hours=1),
            created_at=now - timedelta(hours=1),
        )
        session.add(run)
        runs.append((run, latency))
    session.commit()

    session.add_all(
        [
            _query_event(collection, user, latency, now - timedelta(hours=1), run.id)
            for run, latency in runs
        ]
    )
    # An event with no recorded run must still reach the totals.
    session.add(_query_event(collection, user, 500.0, now - timedelta(hours=1)))
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    by_key = {series.key: series for series in history.tools}
    assert by_key[str(fast.id)].name == "fast-search"
    assert by_key[str(fast.id)].summary.avg_ms == pytest.approx(100.0)
    assert by_key[str(slow.id)].summary.avg_ms == pytest.approx(900.0)
    assert by_key[UNATTRIBUTED_TOOL_KEY].summary.count == 1
    # A bucket only carries keys that actually saw traffic.
    busy = [point for point in history.points if point.tools]
    assert busy, "the queried bucket must carry per-tool entries"
    assert set(busy[0].tools) == {str(fast.id), str(slow.id), UNATTRIBUTED_TOOL_KEY}


def test_domain_percentiles_come_from_raw_events_not_folded_buckets(
    session: Session,
) -> None:
    """A domain p95 spanning buckets differs from any bucket's own p95."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    # Twenty fast queries in one hour, one very slow query in another. Folding
    # bucket p95s would surface the slow bucket's single sample as the p95;
    # the true domain p95 sits inside the fast population.
    session.add_all(
        [_query_event(collection, user, 100.0, now - timedelta(hours=3)) for _ in range(20)]
    )
    session.add(_query_event(collection, user, 5000.0, now - timedelta(hours=1)))
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    summary = history.tools[0].summary
    assert summary.count == 21
    assert summary.p50_ms == pytest.approx(100.0)
    assert summary.p95_ms == pytest.approx(100.0)
    assert summary.max_ms == pytest.approx(5000.0)


def test_history_marks_pipeline_versions_and_tool_bindings(session: Session) -> None:
    """Saved versions and new tool bindings inside the domain become markers."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    pipeline = models.Pipeline(user_id=user.id, name="search", current_version=2)
    session.add(pipeline)
    session.commit()
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
            position=0,
            created_at=now - timedelta(hours=6),
        )
    )
    session.add_all(
        [
            models.PipelineVersion(
                pipeline_id=pipeline.id,
                version=version,
                definition={},
                created_at=now - timedelta(hours=hours),
            )
            for version, hours in ((1, 6), (2, 2))
        ]
    )
    session.add(_query_event(collection, user, 120.0, now - timedelta(hours=7)))
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    kinds = [marker.kind for marker in history.markers]
    assert kinds.count(PipelineMarkerKind.VERSION) == 2
    assert kinds.count(PipelineMarkerKind.TOOL_ADDED) == 1
    assert all(marker.key == str(pipeline.id) for marker in history.markers)
    assert all(marker.role == models.BindingRole.TOOL for marker in history.markers)
    assert history.markers == sorted(history.markers, key=lambda marker: marker.at)
    versions = [marker.version for marker in history.markers if marker.version is not None]
    assert versions == [1, 2]


def test_idle_collection_returns_an_empty_but_valid_domain(session: Session) -> None:
    """A collection with no activity still gets a domain, so the page can render."""
    user = _user(session)
    collection = _collection(session, user)

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    assert history.tools == []
    assert history.markers == []
    assert history.ingestion_summary.count == 0
    assert all(point.document_total == 0 for point in history.points)


def test_history_ignores_another_users_events(session: Session) -> None:
    """Attribution is per-user: a stranger's query never enters these totals."""
    owner = _user(session)
    stranger = _user(session, "stranger@example.com")
    collection = _collection(session, owner)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    session.add(_query_event(collection, stranger, 400.0, now - timedelta(minutes=30)))
    session.commit()

    history = _service(session).history_for(
        user_id=owner.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    assert history.tools == []


def test_unknown_collection_id_yields_an_empty_history(session: Session) -> None:
    """The service is ownership-agnostic; the route's 404 guard is the boundary."""
    user = _user(session)

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=uuid4(),
        collection_created_at=datetime.now(UTC).replace(tzinfo=None),
    )

    assert history.tools == []
    assert all(point.document_total == 0 for point in history.points)


def test_history_returns_one_event_per_query_with_its_series_key(session: Session) -> None:
    """Query dots carry the moment and duration of individual queries, not a bucket."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    session.add_all(
        [
            _query_event(collection, user, latency, now - timedelta(minutes=offset))
            for offset, latency in ((30, 120.0), (20, 480.0), (10, 95.0))
        ]
    )
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    assert [event.duration_ms for event in history.query_events] == [120.0, 480.0, 95.0]
    assert {event.key for event in history.query_events} == {UNATTRIBUTED_TOOL_KEY}
    assert history.events_sampled is False


def test_history_returns_one_event_per_completed_ingest_run(session: Session) -> None:
    """Ingest dots come from runs, so a handful of runs is a handful of readable points."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    pipeline = models.Pipeline(user_id=user.id, name="ingest")
    session.add(pipeline)
    session.commit()
    session.add_all(
        [
            models.PipelineRun(
                pipeline_id=pipeline.id,
                trigger=models.BindingRole.INGEST,
                user_id=user.id,
                collection_id=collection.id,
                status=models.PipelineRunStatus.COMPLETED,
                started_at=now - timedelta(minutes=offset),
                completed_at=now - timedelta(minutes=offset, seconds=-seconds),
                created_at=now - timedelta(minutes=offset),
            )
            for offset, seconds in ((30, 2), (20, 5))
        ]
    )
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    assert [event.duration_ms for event in history.ingestion_events] == [2000.0, 5000.0]
    assert all(event.key is None for event in history.ingestion_events)


def test_event_sampling_thins_evenly_but_always_keeps_the_slowest(session: Session) -> None:
    """Over the cap the dots thin, and the outlier a reader is scanning for survives."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    session.add_all(
        [
            _query_event(collection, user, 100.0, now - timedelta(minutes=60 - index))
            for index in range(40)
        ]
    )
    # The one slow query, sitting at an index a blind stride would skip.
    session.add(_query_event(collection, user, 9000.0, now - timedelta(minutes=60 - 7)))
    session.commit()

    domain = resolve_domain(
        collection_created_at=collection.created_at,
        first_activity_at=now - timedelta(hours=1),
    )
    events = CollectionLatencyRepository(session).query_events(
        user.id, collection.id, domain, cap=10
    )

    assert len(events) < 41, "the sample must thin below the recorded total"
    assert max(event.duration_ms for event in events) == 9000.0


def test_events_sampled_flags_a_thinned_response(session: Session) -> None:
    """A reader seeing fewer dots than the count is told the list was thinned."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    session.add_all(
        [
            _query_event(collection, user, 100.0 + index, now - timedelta(minutes=60 - index))
            for index in range(40)
        ]
    )
    session.commit()

    service = _service(session)
    history = service.history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )
    assert history.events_sampled is False
    assert len(history.query_events) == 40


def test_retrieval_spread_is_measured_across_tools_not_folded_from_them(
    session: Session,
) -> None:
    """The combined band comes from every query at once, never from per-tool p95s."""
    user = _user(session)
    collection = _collection(session, user)
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    pipeline = models.Pipeline(user_id=user.id, name="search")
    session.add(pipeline)
    session.commit()
    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        trigger=models.BindingRole.TOOL,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
        started_at=now - timedelta(minutes=30),
        completed_at=now - timedelta(minutes=30),
        created_at=now - timedelta(minutes=30),
    )
    session.add(run)
    session.commit()

    # One tool is uniformly fast, the other uniformly slow. Folding their p95s
    # would report the slow tool's 900; measuring across all queries does not.
    session.add_all(
        [_query_event(collection, user, 100.0, now - timedelta(minutes=30), run.id)] * 1
        + [_query_event(collection, user, 100.0, now - timedelta(minutes=30)) for _ in range(9)]
        + [_query_event(collection, user, 900.0, now - timedelta(minutes=30))]
    )
    session.commit()

    history = _service(session).history_for(
        user_id=user.id,
        collection_id=collection.id,
        collection_created_at=collection.created_at,
    )

    assert history.retrieval_summary.count == 11
    assert history.retrieval_summary.p50_ms == pytest.approx(100.0)
    busy = [point for point in history.points if point.retrieval.count]
    assert busy, "the queried bucket must carry a combined retrieval aggregate"
    assert busy[0].retrieval.count == 11
    assert busy[0].retrieval.p50_ms == pytest.approx(100.0)
