from __future__ import annotations

import threading
from dataclasses import dataclass, field

from app.cache import ResourceCache


@dataclass
class Resource:
    name: str
    closed: threading.Event = field(default_factory=threading.Event)

    def close(self) -> None:
        self.closed.set()


def test_creation_is_single_flight_and_keys_are_stored_as_opaque_digests() -> None:
    cache = ResourceCache[str, Resource](max_entries=4, key_material=lambda key: key)
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def factory() -> Resource:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(timeout=1)
        return Resource("shared")

    resources: list[Resource] = []
    threads = [
        threading.Thread(target=lambda: resources.append(cache.get_or_create("secret", factory)))
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    assert started.wait(timeout=1)
    release.set()
    for thread in threads:
        thread.join(timeout=1)

    assert calls == 1
    assert resources == [resources[0]] * 4
    assert "secret" not in cache._stored_identifiers()  # pylint: disable=protected-access
    assert len(cache._stored_identifiers()[0]) == 64  # pylint: disable=protected-access
    cache.close_all()


def test_factory_runs_outside_global_lock() -> None:
    cache = ResourceCache[str, Resource](max_entries=4)

    def factory() -> Resource:
        nested = cache.get_or_create("nested", lambda: Resource("nested"))
        assert nested.name == "nested"
        return Resource("outer")

    assert cache.get_or_create("outer", factory).name == "outer"
    cache.close_all()


def test_lru_eviction_closes_resource_outside_global_lock() -> None:
    cache = ResourceCache[str, Resource](max_entries=1)
    first = Resource("first")
    close_entered = threading.Event()
    release_close = threading.Event()

    def blocking_close() -> None:
        close_entered.set()
        assert release_close.wait(timeout=1)
        first.closed.set()

    first.close = blocking_close  # type: ignore[method-assign]
    cache.get_or_create("first", lambda: first)

    inserting = threading.Thread(
        target=lambda: cache.get_or_create("second", lambda: Resource("second"))
    )
    inserting.start()
    assert close_entered.wait(timeout=1)

    assert cache.get_or_create("second", lambda: Resource("wrong")).name == "second"
    release_close.set()
    inserting.join(timeout=1)
    assert first.closed.is_set()
    cache.close_all()


def test_invalidate_closes_completed_resource() -> None:
    cache = ResourceCache[str, Resource](max_entries=2)
    resource = cache.get_or_create("key", lambda: Resource("old"))

    assert cache.invalidate("key") is True
    assert resource.closed.is_set()
    replacement = cache.get_or_create("key", lambda: Resource("new"))
    assert replacement.name == "new"
    cache.close_all()


def test_invalidate_pending_creation_closes_it_after_factory_finishes() -> None:
    cache = ResourceCache[str, Resource](max_entries=2)
    started = threading.Event()
    release = threading.Event()
    created = Resource("created")

    def factory() -> Resource:
        started.set()
        assert release.wait(timeout=1)
        return created

    thread = threading.Thread(target=lambda: cache.get_or_create("key", factory))
    thread.start()
    assert started.wait(timeout=1)
    assert cache.invalidate("key") is True
    release.set()
    thread.join(timeout=1)
    assert created.closed.is_set()


def test_close_all_detaches_and_closes_every_resource() -> None:
    cache = ResourceCache[str, Resource](max_entries=2)
    first = cache.get_or_create("first", lambda: Resource("first"))
    second = cache.get_or_create("second", lambda: Resource("second"))

    cache.close_all()

    assert first.closed.is_set()
    assert second.closed.is_set()
    replacement = cache.get_or_create("first", lambda: Resource("replacement"))
    assert replacement is not first
    cache.close_all()
