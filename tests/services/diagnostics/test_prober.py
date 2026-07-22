"""`VectorStoreProber` degradation and budget behavior (no DB needed)."""

from __future__ import annotations

import pytest

from app.schemas.enums import IndexBackend
from app.services.diagnostics.prober import ProbeUnavailable, VectorStoreProber
from app.vectorstores.base import IndexStats


class _RaisingProvider:
    def get(self, _backend: object) -> object:
        raise RuntimeError("store down")


class _StubStore:
    def __init__(self) -> None:
        self.calls = 0

    def index_stats(self, index: str, namespace: str | None = None) -> IndexStats:
        del index, namespace
        self.calls += 1
        return IndexStats(exists=True, count=3)


class _OneStoreProvider:
    def __init__(self, store: _StubStore) -> None:
        self._store = store

    def get(self, _backend: object) -> _StubStore:
        return self._store


def test_probe_budget_exhausted_raises():
    """A spent budget raises before contacting the store."""
    ticks = iter([0.0, 0.0])  # construction deadline, then the check
    prober = VectorStoreProber(
        user=None,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
        budget_seconds=0.0,
        clock=lambda: next(ticks),
    )
    prober._provider = _RaisingProvider()  # type: ignore[assignment]  # never reached
    with pytest.raises(ProbeUnavailable):
        prober.stats(IndexBackend.PGVECTOR, "idx")


def test_probe_store_failure_degrades_to_unavailable():
    """A store/prerequisite failure surfaces as ProbeUnavailable, not the raw error."""
    prober = VectorStoreProber(
        user=None,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
        clock=lambda: 0.0,
    )
    prober._provider = _RaisingProvider()  # type: ignore[assignment]
    with pytest.raises(ProbeUnavailable, match="store down"):
        prober.stats(IndexBackend.PGVECTOR, "idx")


def test_probe_memoizes_per_target():
    """Repeated probes of the same target hit the store once."""
    store = _StubStore()
    prober = VectorStoreProber(
        user=None,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
        clock=lambda: 0.0,
    )
    prober._provider = _OneStoreProvider(store)  # type: ignore[assignment]
    first = prober.stats(IndexBackend.PGVECTOR, "idx", "ns")
    second = prober.stats(IndexBackend.PGVECTOR, "idx", "ns")
    assert first == second
    assert store.calls == 1
