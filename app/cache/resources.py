"""Bounded cache for closeable resources such as provider clients."""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from typing import Generic, Protocol, TypeVar


class SupportsClose(Protocol):
    """Structural contract for resources owned by this cache."""

    def close(self) -> None:
        """Release resources held by the object."""
        ...  # pragma: no cover - protocol declaration


KeyT = TypeVar("KeyT")
ResourceT = TypeVar("ResourceT", bound=SupportsClose)


class ResourceCache(Generic[KeyT, ResourceT]):
    """Single-flight LRU cache that closes detached resources outside its lock."""

    def __init__(
        self,
        max_entries: int,
        *,
        key_material: Callable[[KeyT], str] = repr,
    ) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be at least one")
        self._max_entries = max_entries
        self._key_material = key_material
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, Future[ResourceT]] = OrderedDict()

    def get_or_create(self, key: KeyT, factory: Callable[[], ResourceT]) -> ResourceT:
        """Return one resource per opaque key, constructing it outside the cache lock."""
        identifier = self._identifier(key)
        with self._lock:
            future = self._entries.get(identifier)
            if future is None:
                future = Future()
                self._entries[identifier] = future
                creator = True
            else:
                self._entries.move_to_end(identifier)
                creator = False

        if not creator:
            return future.result()

        try:
            resource = factory()
        except BaseException as exc:
            future.set_exception(exc)
            with self._lock:
                if self._entries.get(identifier) is future:
                    del self._entries[identifier]
            raise

        future.set_result(resource)
        with self._lock:
            if self._entries.get(identifier) is future:
                self._entries.move_to_end(identifier)
            detached = self._detach_excess_locked()
        self._close_futures(detached)
        return resource

    def invalidate(self, key: KeyT) -> bool:
        """Detach and close the resource for `key`, if present."""
        identifier = self._identifier(key)
        with self._lock:
            future = self._entries.pop(identifier, None)
        if future is None:
            return False
        self._close_futures([future])
        return True

    def close_all(self) -> None:
        """Detach every entry and close resources without holding the cache lock."""
        with self._lock:
            futures = list(self._entries.values())
            self._entries.clear()
        self._close_futures(futures)

    def _identifier(self, key: KeyT) -> str:
        material = self._key_material(key).encode("utf-8")
        return hashlib.sha256(material).hexdigest()

    def _detach_excess_locked(self) -> list[Future[ResourceT]]:
        detached: list[Future[ResourceT]] = []
        while len(self._entries) > self._max_entries:
            identifier = next(
                (
                    candidate
                    for candidate, future in self._entries.items()
                    if future.done()
                ),
                None,
            )
            if identifier is None:
                break
            detached.append(self._entries.pop(identifier))
        return detached

    @staticmethod
    def _close_futures(futures: list[Future[ResourceT]]) -> None:
        for future in futures:
            if future.done():
                ResourceCache._close_completed(future)
            else:
                future.add_done_callback(ResourceCache._close_completed)

    @staticmethod
    def _close_completed(future: Future[ResourceT]) -> None:
        if future.cancelled() or future.exception() is not None:
            return
        future.result().close()

    def _stored_identifiers(self) -> tuple[str, ...]:
        """Return opaque identifiers for cache-invariant tests."""
        with self._lock:
            return tuple(self._entries)
