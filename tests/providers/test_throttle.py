"""Connection throttle and retry behavior (fake clock, no real sleeps)."""

from __future__ import annotations

import httpx
import pytest

from app.providers.throttle import (
    RetryOutcome,
    RetryPolicy,
    call_with_retries,
    connection_slot,
    is_retryable,
)


def _http_status_error(status: int, headers: dict[str, str] | None = None) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://provider.test/chat")
    response = httpx.Response(status, request=request, headers=headers or {})
    return httpx.HTTPStatusError("boom", request=request, response=response)


def test_retries_429_then_succeeds() -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def flaky() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise _http_status_error(429)
        return "ok"

    outcome = RetryOutcome()
    result = call_with_retries(flaky, outcome=outcome, sleep=sleeps.append)
    assert result == "ok"
    assert outcome.retries == 2
    assert len(sleeps) == 2


def test_honors_retry_after_header() -> None:
    sleeps: list[float] = []
    calls = {"n": 0}

    def flaky() -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise _http_status_error(429, {"retry-after": "7"})
        return "ok"

    call_with_retries(flaky, sleep=sleeps.append)
    assert sleeps == [7.0]


def test_non_retryable_client_error_raises_immediately() -> None:
    calls = {"n": 0}

    def bad_request() -> str:
        calls["n"] += 1
        raise _http_status_error(400)

    with pytest.raises(httpx.HTTPStatusError):
        call_with_retries(bad_request, sleep=lambda _: None)
    assert calls["n"] == 1


def test_own_bugs_are_never_retried() -> None:
    assert not is_retryable(KeyError("oops"))


def test_transport_failure_without_status_is_retryable() -> None:
    request = httpx.Request("POST", "https://provider.test/chat")
    assert is_retryable(httpx.ConnectTimeout("slow", request=request))


def test_attempts_exhausted_reraises_last_error() -> None:
    def always_limited() -> str:
        raise _http_status_error(429)

    with pytest.raises(httpx.HTTPStatusError):
        call_with_retries(
            always_limited, policy=RetryPolicy(attempts=2), sleep=lambda _: None
        )


def test_connection_slot_limits_concurrency() -> None:
    import threading
    from uuid import uuid4

    connection = uuid4()
    active = {"now": 0, "peak": 0}
    lock = threading.Lock()

    def work() -> None:
        with connection_slot(connection, 2):
            with lock:
                active["now"] += 1
                active["peak"] = max(active["peak"], active["now"])
            threading.Event().wait(0.01)
            with lock:
                active["now"] -= 1

    threads = [threading.Thread(target=work) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert active["peak"] <= 2
