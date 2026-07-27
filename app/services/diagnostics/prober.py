"""Lazy, budget-bounded vector-store probe for collection diagnostics.

Category-C rules ask the live store whether a collection's index exists and
how many vectors it holds. Those probes are the only part of diagnostics that
touches an external system, so they are isolated here: constructed lazily,
share one total time budget per diagnostics request (never per-probe timeouts
that stack), and raise `ProbeUnavailable` on any failure so the rule degrades
to an informational finding instead of sinking the endpoint.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from sqlmodel import Session

from app.db import models
from app.schemas.enums import IndexBackend
from app.vectorstores.base import IndexStats
from app.vectorstores.registry import VectorStoreProvider

# Total wall-clock a single diagnostics request may spend probing stores. A
# hybrid default has two index targets; the budget is shared across all of
# them so a slow store can't stack multiple full timeouts before the status
# card renders.
DEFAULT_PROBE_BUDGET_SECONDS = 3.0


class ProbeUnavailable(Exception):
    """A probe could not complete (store unreachable or budget exhausted)."""


class VectorStoreProber:
    """Serves `index_stats` for diagnostics rules under a shared time budget.

    Bound to one user + session; results are memoized per
    `(backend, index, namespace)` so repeated rules probing the same target
    pay once. The budget is coarse (checked before each probe, plus the
    underlying client's own timeout) -- enough to stop many probes from
    stacking, not a hard per-call kill.
    """

    def __init__(
        self,
        user: models.User,
        session: Session,
        *,
        budget_seconds: float = DEFAULT_PROBE_BUDGET_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Bind the prober to the request's user/session and start the budget."""
        self._provider = VectorStoreProvider(user, session)
        self._budget_seconds = budget_seconds
        self._clock = clock
        self._deadline = clock() + budget_seconds
        self._cache: dict[tuple[IndexBackend, str, str | None], IndexStats] = {}

    def stats(
        self,
        backend: IndexBackend,
        index: str,
        namespace: str | None = None,
    ) -> IndexStats:
        """Return existence + count for an index, or raise `ProbeUnavailable`.

        Raises before contacting the store once the shared budget is spent, so
        the first slow probe bounds the rest.
        """
        key = (backend, index, namespace)
        if key in self._cache:
            return self._cache[key]
        if self._clock() >= self._deadline:
            raise ProbeUnavailable("Diagnostics probe budget exhausted.")
        try:
            store = self._provider.get(backend)
            stats = store.index_stats(index, namespace)
        except Exception as exc:
            # Any store/prerequisite failure degrades to an informational
            # finding; the rule must never propagate it to the endpoint.
            raise ProbeUnavailable(str(exc)) from exc
        self._cache[key] = stats
        return stats
