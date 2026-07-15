from __future__ import annotations

import threading
import time
from collections.abc import Callable

import pytest

from app.cache import CachePolicy, ValueCache


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def cache(clock: FakeClock) -> ValueCache[str, str]:
    value_cache = ValueCache[str, str](
        CachePolicy(
            fresh_seconds=10,
            max_stale_seconds=20,
            failure_retry_seconds=5,
            max_entries=2,
        ),
        clock=clock,
        refresh_workers=2,
    )
    yield value_cache
    value_cache.close()


def _wait_until(predicate: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 1
    while not predicate():
        if time.monotonic() >= deadline:
            pytest.fail("condition was not reached")
        time.sleep(0.005)


def test_cold_and_fresh_reads_load_once(
    cache: ValueCache[str, str], clock: FakeClock
) -> None:
    loads = 0

    def loader() -> str:
        nonlocal loads
        loads += 1
        return f"value-{loads}"

    cold = cache.get("key", loader)
    clock.advance(9)
    fresh = cache.get("key", loader)

    assert cold.value == "value-1"
    assert cold.freshness == "fresh"
    assert cold.age_seconds == 0
    assert cold.refreshing is False
    assert cold.warning is None
    assert fresh.value == "value-1"
    assert fresh.age_seconds == 9
    assert loads == 1


def test_stale_read_returns_immediately_and_refreshes_once(
    cache: ValueCache[str, str], clock: FakeClock
) -> None:
    refresh_started = threading.Event()
    release_refresh = threading.Event()
    loads = 0

    def loader() -> str:
        nonlocal loads
        loads += 1
        if loads == 2:
            refresh_started.set()
            assert release_refresh.wait(timeout=1)
        return f"value-{loads}"

    cache.get("key", loader)
    clock.advance(11)

    stale = cache.get("key", loader)
    assert refresh_started.wait(timeout=1)
    concurrent = cache.get("key", loader)

    assert stale.value == "value-1"
    assert stale.freshness == "stale"
    assert stale.refreshing is True
    assert concurrent.value == "value-1"
    assert loads == 2

    release_refresh.set()
    _wait_until(lambda: cache.get("key", loader).value == "value-2")


def test_over_age_read_blocks_for_refresh(
    cache: ValueCache[str, str], clock: FakeClock
) -> None:
    loads = iter(["old", "new"])
    cache.get("key", lambda: next(loads))
    clock.advance(31)

    refreshed = cache.get("key", lambda: next(loads))

    assert refreshed.value == "new"
    assert refreshed.freshness == "fresh"
    assert refreshed.age_seconds == 0


@pytest.mark.parametrize("force_refresh", [False, True])
def test_blocking_loads_are_single_flight(
    clock: FakeClock, force_refresh: bool
) -> None:
    cache = ValueCache[str, str](
        CachePolicy(10, 20, 5, 8), clock=clock, refresh_workers=1
    )
    if force_refresh:
        cache.get("key", lambda: "old")

    started = threading.Event()
    release = threading.Event()
    calls = 0

    def loader() -> str:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(timeout=1)
        return "new"

    results: list[str] = []
    threads = [
        threading.Thread(
            target=lambda: results.append(
                cache.get("key", loader, force_refresh=force_refresh).value
            )
        )
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    assert started.wait(timeout=1)
    release.set()
    for thread in threads:
        thread.join(timeout=1)

    assert results == ["new"] * 4
    assert calls == 1
    cache.close()


def test_failed_background_refresh_preserves_value_and_observes_retry_delay(
    cache: ValueCache[str, str], clock: FakeClock
) -> None:
    calls = 0
    failed = threading.Event()

    def loader() -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            failed.set()
            raise RuntimeError("provider unavailable")
        return f"value-{calls}"

    cache.get("key", loader)
    clock.advance(11)
    cache.get("key", loader)
    assert failed.wait(timeout=1)
    _wait_until(lambda: cache.get("key", loader).refreshing is False)

    during_delay = cache.get("key", loader)
    assert during_delay.value == "value-1"
    assert during_delay.warning == "provider unavailable"
    assert calls == 2

    clock.advance(5)
    retrying = cache.get("key", loader)
    assert retrying.refreshing is True
    _wait_until(lambda: cache.get("key", loader).value == "value-3")


def test_lru_evicts_only_completed_entries(clock: FakeClock) -> None:
    cache = ValueCache[str, str](
        CachePolicy(None, 0, 1, 2), clock=clock, refresh_workers=1
    )
    started = threading.Event()
    release = threading.Event()

    def blocked_loader() -> str:
        started.set()
        assert release.wait(timeout=1)
        return "blocked"

    thread = threading.Thread(target=lambda: cache.get("blocked", blocked_loader))
    thread.start()
    assert started.wait(timeout=1)
    cache.get("first", lambda: "first")
    cache.get("second", lambda: "second")
    release.set()
    thread.join(timeout=1)

    first_reloads = 0

    def first_loader() -> str:
        nonlocal first_reloads
        first_reloads += 1
        return "first-again"

    assert cache.get("blocked", lambda: "wrong").value == "blocked"
    assert cache.get("first", first_loader).value == "first-again"
    assert first_reloads == 1
    cache.close()


def test_invalidation_and_clear_require_new_load(cache: ValueCache[str, str]) -> None:
    cache.get("a", lambda: "a1")
    cache.get("b", lambda: "b1")

    assert cache.invalidate("a") is True
    assert cache.invalidate_matching(lambda key: key == "b") == 1
    assert cache.get("a", lambda: "a2").value == "a2"
    assert cache.get("b", lambda: "b2").value == "b2"

    cache.clear()
    assert cache.get("a", lambda: "a3").value == "a3"


def test_close_waits_for_refresh_and_cache_can_be_reused(clock: FakeClock) -> None:
    cache = ValueCache[str, str](
        CachePolicy(0, 10, 1, 2), clock=clock, refresh_workers=1
    )
    cache.get("key", lambda: "old")
    clock.advance(1)
    release = threading.Event()
    started = threading.Event()

    def loader() -> str:
        started.set()
        assert release.wait(timeout=1)
        return "new"

    cache.get("key", loader)
    assert started.wait(timeout=1)
    close_thread = threading.Thread(target=cache.close)
    close_thread.start()
    assert close_thread.is_alive()
    release.set()
    close_thread.join(timeout=1)

    assert cache.get("other", lambda: "recreated").value == "recreated"
    cache.close()


def test_invalidate_during_background_refresh_discards_the_refresh_result(
    cache: ValueCache[str, str], clock: FakeClock
) -> None:
    refresh_started = threading.Event()
    release_refresh = threading.Event()
    loads = 0

    def loader() -> str:
        nonlocal loads
        loads += 1
        if loads == 2:
            refresh_started.set()
            assert release_refresh.wait(timeout=1)
        return f"value-{loads}"

    cache.get("key", loader)
    clock.advance(11)
    cache.get("key", loader)
    assert refresh_started.wait(timeout=1)

    assert cache.invalidate("key") is True

    release_refresh.set()
    reloaded = cache.get("key", loader)

    assert reloaded.value == "value-3"
    assert loads == 3
