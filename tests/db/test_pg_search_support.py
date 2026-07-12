"""The pg_search availability flag: bootstrap behavior and test isolation.

Mirrors `test_pgvector_support.py` for the BM25 extension: the first test
flips the flag through the real bootstrap failure path, the second proves the
autouse reset in `tests/conftest.py` restored it (they are deliberately
order-coupled within this file).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from app.db.bootstrap import ensure_pg_search_extension
from app.db.pg_search_support import pg_search_available


class _FailingEngine:
    """An engine whose connections always fail (no extension, no permissions...)."""

    @contextmanager
    def begin(self) -> Iterator[None]:
        raise RuntimeError("could not open extension control file")
        yield  # pragma: no cover - unreachable


def test_a_extension_failure_disables_bm25_without_raising() -> None:
    assert ensure_pg_search_extension(_FailingEngine()) is False  # type: ignore[arg-type]
    assert pg_search_available() is False


def test_b_flag_is_reset_between_tests() -> None:
    """The previous test left the flag False; the autouse fixture must reset it."""
    assert pg_search_available() is True
