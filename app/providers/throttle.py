"""Connection-scoped concurrency limiting, pacing, and retry for model calls.

The provider connection is the thing being rate-limited — a laptop Ollama
and a tier-4 cloud key differ by orders of magnitude — so the semaphore
registry is process-wide and keyed by connection id, and it is holistic:
chat, embedding, and reranking requests through one connection all share
the same budget (providers meter per endpoint, so a shared window is
deliberately conservative — and embedding calls are batched, so the
conservatism costs little). Limits come from the connection's
`max_concurrent_requests`/`requests_per_minute` config, falling back to
the provider type's defaults.

Retries are reactive: exponential backoff with jitter on provider-side
failures (429/5xx/timeouts), honoring `Retry-After`. What happens after the
attempts are exhausted is the caller's failure policy, not this module's.

`call_with_retries` stays a pure function taking an explicit `RetryPolicy` —
it never reads app config itself, so a policy lookup never lands on every
provider call. `resolve_retry_policy()` is the one place that reads
`providers.max_retry_attempts`; callers invoke it once, at the point a
throttled proxy or the LLM engine is constructed (a run, a bulk chat setup),
and pass the resulting policy down.
"""

from __future__ import annotations

import random
import threading
import time
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TypeVar
from uuid import UUID

from app.services.app_config import get_app_config
from app.services.errors import is_external_provider_error

T = TypeVar("T")

_registry_lock = threading.Lock()
_semaphores: dict[UUID, tuple[int, threading.BoundedSemaphore]] = {}
_rate_windows: dict[tuple[UUID, str], tuple[threading.Lock, deque[float]]] = {}

#: Statuses worth retrying: rate limits and transient server faults.
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})

_WINDOW_SECONDS = 60.0


def _pace_request(
    connection_id: UUID, window_key: str, rpm: int, sleep: Callable[[float], None]
) -> None:
    """Block until the connection's sliding one-minute window has room.

    The window records request start times; when it is full, the caller
    sleeps until the oldest recorded request ages out. Proactive pacing —
    reactive 429 backoff stays underneath as the safety net for tiers the
    setting overstates. `window_key` is "shared" unless a request kind
    carries its own pace (see `ProviderAdapter.request_pace`).
    """
    with _registry_lock:
        entry = _rate_windows.get((connection_id, window_key))
        if entry is None:
            entry = (threading.Lock(), deque())
            _rate_windows[(connection_id, window_key)] = entry
    lock, window = entry
    while True:
        with lock:
            now = time.monotonic()
            while window and now - window[0] >= _WINDOW_SECONDS:
                window.popleft()
            if len(window) < rpm:
                window.append(now)
                return
            wait = _WINDOW_SECONDS - (now - window[0])
        sleep(max(wait, 0.05))


@contextmanager
def connection_slot(
    connection_id: UUID,
    limit: int,
    *,
    rpm: int | None = None,
    window: str = "shared",
    sleep: Callable[[float], None] | None = None,
) -> Iterator[None]:
    """Hold one of the connection's concurrent-request slots, paced to `rpm`.

    A changed limit (the user edited the connection) rebuilds the semaphore;
    in-flight holders of the old one drain independently, which transiently
    overshoots by at most the old limit — acceptable for a safety valve.
    Pacing happens *inside* the held slot so a full window never parks more
    than `limit` threads in sleep loops.
    """
    limit = max(1, limit)
    with _registry_lock:
        entry = _semaphores.get(connection_id)
        if entry is None or entry[0] != limit:
            entry = (limit, threading.BoundedSemaphore(limit))
            _semaphores[connection_id] = entry
    semaphore = entry[1]
    semaphore.acquire()
    try:
        if rpm is not None and rpm >= 1:
            _pace_request(connection_id, window, rpm, sleep if sleep is not None else time.sleep)
        yield
    finally:
        semaphore.release()


@dataclass(frozen=True)
class RetryPolicy:
    """Backoff shape for one call site."""

    attempts: int = 5
    base_delay: float = 1.0
    max_delay: float = 30.0

    def delay_for(self, attempt: int, retry_after: float | None) -> float:
        """Return the sleep before retry `attempt` (0-based), with jitter."""
        if retry_after is not None:
            return min(max(retry_after, 0.0), self.max_delay)
        exponential = min(self.base_delay * float(2**attempt), self.max_delay)
        return exponential * (0.5 + random.random() / 2)


def resolve_retry_policy() -> RetryPolicy:
    """Build the transport retry policy from `providers.max_retry_attempts`.

    Call this once at each throttled-proxy/engine construction site — never
    per call, and never from inside `call_with_retries` itself (see module
    docstring).
    """
    return RetryPolicy(attempts=get_app_config().providers.max_retry_attempts)


def _status_of(exc: Exception) -> int | None:
    """Best-effort HTTP status from the SDK/HTTP exception families."""
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) else None


def _retry_after_of(exc: Exception) -> float | None:
    """`Retry-After` seconds when the provider's response carries one."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    try:
        raw = headers.get("retry-after")
    except (AttributeError, TypeError):
        return None
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def is_retryable(exc: Exception) -> bool:
    """Retry provider-side faults only — never our own bugs.

    A provider exception with no extractable status is a transport failure
    (timeout, dropped connection) and is retried; one with a status retries
    only on 429/5xx — a 400/401 will fail identically every attempt.
    """
    if not is_external_provider_error(exc):
        return False
    status = _status_of(exc)
    return status is None or status in _RETRYABLE_STATUSES


@dataclass
class RetryOutcome:
    """What one throttled call took to succeed."""

    retries: int = 0


def call_with_retries(
    call: Callable[[], T],
    *,
    policy: RetryPolicy | None = None,
    retryable: Callable[[Exception], bool] = is_retryable,
    outcome: RetryOutcome | None = None,
    sleep: Callable[[float], None] | None = None,
) -> T:
    """Run `call`, retrying failures `retryable` accepts, with backoff.

    `retryable` defaults to `is_retryable` (provider transport faults only).
    A caller retrying a genuinely different failure class — an LLM node's
    output-shape misses are not congestion — passes its own predicate and
    policy instead of widening this one: two distinct failure classes stay
    two distinct policies, never merged into one predicate.

    `sleep` resolves to `time.sleep` at call time (not def time) so tests
    can monkeypatch the module attribute and never wait out real backoff.
    """
    policy = policy or RetryPolicy()
    if sleep is None:
        sleep = time.sleep
    last: Exception | None = None
    for attempt in range(policy.attempts):
        try:
            return call()
        except Exception as exc:
            if not retryable(exc) or attempt == policy.attempts - 1:
                raise
            last = exc
            if outcome is not None:
                outcome.retries += 1
            sleep(policy.delay_for(attempt, _retry_after_of(exc)))
    raise last if last is not None else RuntimeError("unreachable")
