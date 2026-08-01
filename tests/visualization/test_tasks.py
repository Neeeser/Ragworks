"""Behavior tests for insight refresh scheduling."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.enums import InsightStatus
from app.visualization.insights import tasks

# Captured at import time, before the suite's autouse fixture replaces the
# module attribute with a no-op — these tests exercise the real scheduler.
from app.visualization.insights.tasks import schedule_insight_refresh
from tests.visualization.conftest import add_document


class _RecordingExecutor:
    def __init__(self) -> None:
        self.submitted: list[tuple[object, ...]] = []

    def submit(self, fn: object, *args: object) -> None:
        self.submitted.append((fn, *args))


def test_schedule_submits_the_marker_snapshot_id(
    session: Session,
    collection: models.Collection,
    user: models.User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The worker gets a plain UUID, read before the scheduling session
    closes (regression: reading `snapshot.id` after the scope exit raised
    DetachedInstanceError on every post-ingestion refresh)."""
    add_document(
        session,
        collection,
        user,
        "seed.txt",
        [("a", [1.0, 0.0]), ("b", [0.0, 1.0]), ("c", [1.0, 1.0])],
    )
    executor = _RecordingExecutor()
    monkeypatch.setattr(tasks, "_get_executor", lambda: executor)

    assert schedule_insight_refresh(collection.id, user.id) is True

    assert len(executor.submitted) == 1
    _fn, snapshot_id, _request_id = executor.submitted[0]
    assert isinstance(snapshot_id, UUID)
    marker = session.get(models.InsightSnapshotRecord, snapshot_id)
    assert marker is not None
    assert marker.status == InsightStatus.COMPUTING


def test_schedule_is_a_noop_without_enough_chunks(
    session: Session,
    collection: models.Collection,
    user: models.User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = _RecordingExecutor()
    monkeypatch.setattr(tasks, "_get_executor", lambda: executor)

    assert schedule_insight_refresh(collection.id, user.id) is False
    assert executor.submitted == []
