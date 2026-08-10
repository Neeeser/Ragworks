"""Sliding-window RPM pacing behavior (fake clock, no real sleeps)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.providers import throttle
from app.providers.throttle import connection_slot


class _Clock:
    """Fake monotonic clock the fake sleep advances."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    fake = _Clock()
    monkeypatch.setattr(throttle.time, "monotonic", fake.monotonic)
    return fake


def test_calls_within_the_window_pass_without_sleeping(clock: _Clock) -> None:
    connection = uuid4()
    for _ in range(3):
        with connection_slot(connection, 4, rpm=3, sleep=clock.sleep):
            pass
    assert clock.slept == []


def test_full_window_sleeps_until_the_oldest_request_ages_out(clock: _Clock) -> None:
    connection = uuid4()
    for _ in range(2):
        with connection_slot(connection, 4, rpm=2, sleep=clock.sleep):
            pass
    clock.now += 10  # 10s later the window is still full
    with connection_slot(connection, 4, rpm=2, sleep=clock.sleep):
        pass
    # The third call waited out the remaining ~50s of the oldest entry.
    assert len(clock.slept) == 1
    assert clock.slept[0] == pytest.approx(50.0)


def test_no_rpm_means_no_pacing(clock: _Clock) -> None:
    connection = uuid4()
    for _ in range(5):
        with connection_slot(connection, 2, rpm=None, sleep=clock.sleep):
            pass
    assert clock.slept == []


def test_per_kind_windows_pace_independently(clock: _Clock) -> None:
    """A kind carved out into its own window never waits on the shared one."""
    connection = uuid4()
    # Fill the shared window (chat pace).
    for _ in range(2):
        with connection_slot(connection, 4, rpm=2, sleep=clock.sleep):
            pass
    # An embedding call with its own window proceeds without sleeping.
    with connection_slot(connection, 4, rpm=100, window="embedding", sleep=clock.sleep):
        pass
    assert clock.slept == []


def test_throttled_embedder_passes_through_inside_a_slot() -> None:
    """The resolver-wrapped embedder keeps the Embedder contract intact."""
    from uuid import uuid4 as _uuid4

    from app.providers.throttled import ThrottledEmbedder

    class _Inner:
        model_name = "embed-1"
        usage = None
        calls = 0

        def embed_documents(self, chunks: object) -> list[list[float]]:
            _Inner.calls += 1
            return [[0.0]]

        def embed_query(self, query: str) -> list[float]:
            return [0.0]

    wrapped = ThrottledEmbedder(_Inner(), _uuid4(), limit=2, rpm=None, window="embedding")
    assert wrapped.embed_documents([object()]) == [[0.0]]
    assert wrapped.model_name == "embed-1"
    assert _Inner.calls == 1
