"""Connection-scoped concurrency limiting and retry for LLM calls.

The provider connection is the thing being rate-limited — a laptop Ollama
and a tier-4 cloud key differ by orders of magnitude — so the semaphore
registry is process-wide and keyed by connection id: every LLM node sharing
a connection, across nodes and concurrent runs in this process, shares one
budget. The limit comes from the connection's `max_concurrent_requests`
config (falling back to the provider type's default), read by the engine.

Retries are reactive: exponential backoff with jitter on provider-side
failures (429/5xx/timeouts), honoring `Retry-After`. What happens after the
attempts are exhausted is the caller's failure policy, not this module's.
"""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TypeVar
from uuid import UUID

from app.services.errors import is_external_provider_error

T = TypeVar("T")

_registry_lock = threading.Lock()
_semaphores: dict[UUID, tuple[int, threading.BoundedSemaphore]] = {}

#: Statuses worth retrying: rate limits and transient server faults.
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})


@contextmanager
def connection_slot(connection_id: UUID, limit: int) -> Iterator[None]:
    """Hold one of the connection's concurrent-request slots.

    A changed limit (the user edited the connection) rebuilds the semaphore;
    in-flight holders of the old one drain independently, which transiently
    overshoots by at most the old limit — acceptable for a safety valve.
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
    outcome: RetryOutcome | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Run `call`, retrying retryable provider failures with backoff."""
    policy = policy or RetryPolicy()
    last: Exception | None = None
    for attempt in range(policy.attempts):
        try:
            return call()
        except Exception as exc:
            if not is_retryable(exc) or attempt == policy.attempts - 1:
                raise
            last = exc
            if outcome is not None:
                outcome.retries += 1
            sleep(policy.delay_for(attempt, _retry_after_of(exc)))
    raise last if last is not None else RuntimeError("unreachable")
