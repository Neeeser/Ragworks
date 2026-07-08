"""The pgvector availability flag: bootstrap behavior and test isolation.

Regression for the CI failure where `tests/db/test_bootstrap.py` ran `init_db`
against a Postgres without the pgvector extension, flipped the process-wide
availability flag to False, and poisoned every later test that resolved the
pgvector backend. The two tests below are deliberately order-coupled within
this file: the first flips the flag through the real bootstrap failure path,
the second proves the autouse reset in `tests/conftest.py` restored it.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from app.db.bootstrap import ensure_pgvector_extension
from app.db.pgvector_support import pgvector_available


class _FailingEngine:
    """An engine whose connections always fail (no extension, no permissions...)."""

    @contextmanager
    def begin(self) -> Iterator[None]:
        raise RuntimeError("could not open extension control file")
        yield  # pragma: no cover - unreachable


def test_a_extension_failure_disables_backend_without_raising() -> None:
    assert ensure_pgvector_extension(_FailingEngine()) is False  # type: ignore[arg-type]
    assert pgvector_available() is False


def test_b_flag_is_reset_between_tests() -> None:
    """The previous test left the flag False; the autouse fixture must reset it."""
    assert pgvector_available() is True
