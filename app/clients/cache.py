"""Bounded LRU cache for provider clients that closes what it evicts.

`functools.lru_cache` cannot be used for objects that own OS resources: it
drops references on eviction without calling `close()`, leaking the evicted
client's connection pool. This cache is a plain `OrderedDict` guarded by a
lock, with the oldest entry closed and removed whenever an insert would exceed
`max_size`. Shared by every provider client factory (OpenRouter, Ollama).
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable
from typing import Generic, Protocol, TypeVar


class SupportsClose(Protocol):  # pylint: disable=too-few-public-methods
    """Structural type for clients the cache can close on eviction."""

    def close(self) -> None:
        """Release the client's underlying resources."""
        ...  # pragma: no cover - protocol stub


ClientT = TypeVar("ClientT", bound=SupportsClose)


class ClientCache(Generic[ClientT]):  # pylint: disable=too-few-public-methods
    # Owns the cache's lock and dict; one method (`get_or_create`) is the whole
    # contract, there's nothing else this class needs to expose.
    """Bounded LRU cache of provider clients that closes evictions."""

    def __init__(self, max_size: int) -> None:
        """Initialize an empty cache bounded to `max_size` entries."""
        self._max_size = max_size
        self._entries: OrderedDict[str, ClientT] = OrderedDict()
        self._lock = threading.Lock()

    def get_or_create(self, key: str, factory: Callable[[], ClientT]) -> ClientT:
        """Return the cached client for `key`, creating and caching one if absent."""
        with self._lock:
            existing = self._entries.get(key)
            if existing is not None:
                self._entries.move_to_end(key)
                return existing
            client = factory()
            self._entries[key] = client
            if len(self._entries) > self._max_size:
                _evicted_key, evicted_client = self._entries.popitem(last=False)
                evicted_client.close()
            return client
