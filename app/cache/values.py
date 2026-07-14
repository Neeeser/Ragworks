"""Thread-safe stale-while-revalidate cache for loaded values."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Generic, TypeVar, cast

from app.cache.types import CachePolicy, CacheSnapshot

KeyT = TypeVar("KeyT")
ValueT = TypeVar("ValueT")
_MISSING = object()


@dataclass
class _Entry(Generic[ValueT]):
    condition: threading.Condition
    value: ValueT | object = _MISSING
    loaded_at: float = 0.0
    refreshing: bool = False
    warning: str | None = None
    retry_at: float = 0.0


class ValueCache(Generic[KeyT, ValueT]):
    """Cache loaded values with synchronous cold loads and background refreshes."""

    def __init__(
        self,
        policy: CachePolicy,
        *,
        clock: Callable[[], float] = time.monotonic,
        refresh_workers: int = 4,
    ) -> None:
        if refresh_workers < 1:
            raise ValueError("refresh_workers must be at least one")
        self._policy = policy
        self._clock = clock
        self._refresh_workers = refresh_workers
        self._lock = threading.RLock()
        self._entries: OrderedDict[KeyT, _Entry[ValueT]] = OrderedDict()
        self._executor: ThreadPoolExecutor | None = None

    def get(
        self,
        key: KeyT,
        loader: Callable[[], ValueT],
        *,
        force_refresh: bool = False,
    ) -> CacheSnapshot[ValueT]:
        """Return a value, loading or refreshing it according to the cache policy."""
        with self._lock:
            entry = self._entry_for(key)
            if entry.refreshing:
                if entry.value is not _MISSING and not force_refresh:
                    return self._snapshot(entry)
                while entry.refreshing:
                    entry.condition.wait()
                if entry.value is not _MISSING:
                    return self._snapshot(entry)

            if entry.value is _MISSING:
                entry.refreshing = True
            else:
                age = max(0.0, self._clock() - entry.loaded_at)
                if not force_refresh and self._is_fresh(age):
                    return self._snapshot(entry)
                if not force_refresh and self._is_stale_servable(age):
                    if self._clock() >= entry.retry_at:
                        entry.refreshing = True
                        self._submit_refresh(key, entry, loader)
                    return self._snapshot(entry)
                entry.refreshing = True

        return self._load_blocking(key, entry, loader)

    def invalidate(self, key: KeyT) -> bool:
        """Remove an entry by key.

        An in-flight load is detached rather than skipped: its waiters still
        receive the result, but it lands outside the cache — otherwise a
        refresh started before the invalidation would repopulate the entry
        with data loaded from the pre-invalidation state.
        """
        with self._lock:
            return self._entries.pop(key, None) is not None

    def invalidate_matching(self, predicate: Callable[[KeyT], bool]) -> int:
        """Remove every entry whose key matches `predicate` (see `invalidate`)."""
        with self._lock:
            keys = [key for key in self._entries if predicate(key)]
            for key in keys:
                del self._entries[key]
            return len(keys)

    def clear(self) -> None:
        """Remove all completed entries, retaining active flights for their waiters."""
        with self._lock:
            self._entries = OrderedDict(
                (key, entry) for key, entry in self._entries.items() if entry.refreshing
            )

    def close(self) -> None:
        """Wait for background work, clear values, and permit lazy reuse."""
        with self._lock:
            executor = self._executor
            self._executor = None
        if executor is not None:
            executor.shutdown(wait=True)
        self.clear()

    def _entry_for(self, key: KeyT) -> _Entry[ValueT]:
        entry = self._entries.get(key)
        if entry is None:
            entry = _Entry(condition=threading.Condition(self._lock))
            self._entries[key] = entry
            self._evict_completed()
        else:
            self._entries.move_to_end(key)
        return entry

    def _load_blocking(
        self,
        key: KeyT,
        entry: _Entry[ValueT],
        loader: Callable[[], ValueT],
    ) -> CacheSnapshot[ValueT]:
        try:
            value = loader()
        except Exception as exc:
            with self._lock:
                self._record_failure(entry, exc)
            raise
        with self._lock:
            self._record_success(key, entry, value)
            return self._snapshot(entry)

    def _submit_refresh(
        self,
        key: KeyT,
        entry: _Entry[ValueT],
        loader: Callable[[], ValueT],
    ) -> None:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(
                max_workers=self._refresh_workers,
                thread_name_prefix="value-cache-refresh",
            )
        self._executor.submit(self._refresh, key, entry, loader)

    def _refresh(
        self,
        key: KeyT,
        entry: _Entry[ValueT],
        loader: Callable[[], ValueT],
    ) -> None:
        try:
            value = loader()
        except Exception as exc:  # background failures are reported in the snapshot
            with self._lock:
                self._record_failure(entry, exc)
            return
        with self._lock:
            self._record_success(key, entry, value)

    def _record_success(self, key: KeyT, entry: _Entry[ValueT], value: ValueT) -> None:
        entry.value = value
        entry.loaded_at = self._clock()
        entry.refreshing = False
        entry.warning = None
        entry.retry_at = 0.0
        if self._entries.get(key) is entry:
            self._entries.move_to_end(key)
        entry.condition.notify_all()
        self._evict_completed()

    def _record_failure(self, entry: _Entry[ValueT], exc: Exception) -> None:
        entry.refreshing = False
        entry.warning = str(exc)
        entry.retry_at = self._clock() + self._policy.failure_retry_seconds
        entry.condition.notify_all()

    def _snapshot(self, entry: _Entry[ValueT]) -> CacheSnapshot[ValueT]:
        value = cast(ValueT, entry.value)
        age = max(0.0, self._clock() - entry.loaded_at)
        return CacheSnapshot(
            value=value,
            freshness="fresh" if self._is_fresh(age) else "stale",
            age_seconds=age,
            refreshing=entry.refreshing,
            warning=entry.warning,
        )

    def _is_fresh(self, age: float) -> bool:
        fresh_seconds = self._policy.fresh_seconds
        return fresh_seconds is None or age <= fresh_seconds

    def _is_stale_servable(self, age: float) -> bool:
        fresh_seconds = self._policy.fresh_seconds
        if fresh_seconds is None:
            return False
        return age <= fresh_seconds + self._policy.max_stale_seconds

    def _evict_completed(self) -> None:
        while len(self._entries) > self._policy.max_entries:
            evicted = next(
                (
                    key
                    for key, candidate in self._entries.items()
                    if not candidate.refreshing
                ),
                None,
            )
            if evicted is None:
                return
            del self._entries[evicted]
