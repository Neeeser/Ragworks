"""Shared fixtures for the test suite.

Only environment bootstrapping and the function-scoped `session` fixture live
here. Configuration comes from real environment variables only (no env files):
`TEST_DATABASE_URL` may point the suite at a different Postgres instance.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy.engine.url import make_url
from sqlmodel import Session

from tests.utils.db import DEFAULT_TEST_DATABASE_URL, open_session, worker_database_name

TEST_ROOT = Path(__file__).resolve().parent / ".artifacts"
_WORKER = os.getenv("PYTEST_XDIST_WORKER", "solo")
STORAGE_PATH = TEST_ROOT / "storage" / _WORKER
CONFIG_PATH = TEST_ROOT / "config" / _WORKER


def _worker_database_url() -> str:
    """Derive this process's private database URL.

    The configured `TEST_DATABASE_URL` names the *base* database; each pytest
    process (plain run or xdist worker) gets its own database — named per
    worktree and per worker — created from a schema template in
    `tests/utils/db.py`, so parallel workers and concurrent worktree runs
    share one Postgres server without sharing data.
    """
    base = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    url = make_url(base)
    database = worker_database_name(url.database or "ragworks_test")
    return url.set(database=database).render_as_string(hide_password=False)


def _prepare_environment() -> None:
    """Redirect the suite at an isolated database and storage path.

    Postgres is required (many tests hit a real `session` fixture) but no
    live OpenRouter/Pinecone credentials are needed — provider boundaries
    are stubbed.
    """
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    if STORAGE_PATH.exists():
        shutil.rmtree(STORAGE_PATH)

    os.environ["DATABASE_URL"] = _worker_database_url()
    os.environ["FILE_STORAGE_PATH"] = str(STORAGE_PATH)
    os.environ["CONFIG_PATH"] = str(CONFIG_PATH)
    # debug defaults to False (secure-by-default); the suite runs against the
    # dev-mode contract, so opt in the way `make server` does.
    os.environ.setdefault("DEBUG", "true")


_prepare_environment()

from app.core import config as api_config  # noqa: E402

api_config.get_settings.cache_clear()

import app.db.models  # noqa: E402,F401  # register SQLModel metadata before any reset


@pytest.fixture(name="session")
def session_fixture() -> Generator[Session, None, None]:
    yield from open_session()


@pytest.fixture(autouse=True)
def _inert_insight_scheduling(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep insight computation out of the background during tests.

    Ingestion and file deletion schedule insight refreshes on a process-wide
    worker thread; a thread outliving its test holds an open session against
    the worker database, and the next test's `DROP SCHEMA` reset then
    deadlocks behind it. Tests exercising the insights pipeline drive
    `InsightService.run_refresh` synchronously instead; the scheduling seam
    itself is covered by patching this same name and asserting the call.
    """
    monkeypatch.setattr(
        "app.visualization.insights.tasks.schedule_insight_refresh",
        lambda *_args, **_kwargs: False,
    )
    monkeypatch.setattr(
        "app.services.ingestion.schedule_insight_refresh",
        lambda *_args, **_kwargs: False,
    )
    monkeypatch.setattr(
        "app.services.file_deletion.schedule_insight_refresh",
        lambda *_args, **_kwargs: False,
    )


@pytest.fixture(autouse=True)
def _reset_pgvector_availability() -> Generator[None, None, None]:
    """Keep the process-wide pgvector flag from leaking across tests.

    Bootstrap tests exercise `ensure_pgvector_extension`'s failure path, which
    flips the module-level flag to False; without this reset that state
    poisoned every later test that resolves the pgvector backend (the CI
    failure this guards against). Tests that need the flag off set it inside
    their own scope (see `test_pgvector_unavailable_rejected`).
    """
    from app.db.pgvector_support import set_pgvector_available

    set_pgvector_available(True)
    yield
    set_pgvector_available(True)


@pytest.fixture(autouse=True)
def _reset_pg_search_availability() -> Generator[None, None, None]:
    """Keep the process-wide pg_search flag from leaking across tests.

    Same rationale as `_reset_pgvector_availability`: bootstrap tests exercise
    `ensure_pg_search_extension`'s failure path, which flips the module-level
    flag to False for the whole process.
    """
    from app.db.pg_search_support import set_pg_search_available

    set_pg_search_available(True)
    yield
    set_pg_search_available(True)


@pytest.fixture(name="pg_search_session")
def pg_search_session_fixture(session: Session) -> Session:
    """The regular DB session, skipping the test when pg_search is missing.

    The schema template (`tests/utils/db.py`) installs the extension best-effort; a
    Postgres server without pg_search (ParadeDB BM25) skips these tests with
    a named reason instead of failing the suite (see app/AGENTS.md).
    """
    from sqlalchemy import text

    installed = session.exec(  # type: ignore[call-overload]
        text("SELECT 1 FROM pg_extension WHERE extname = 'pg_search'")
    ).first()
    if not installed:
        pytest.skip("pg_search extension unavailable on the test Postgres server")
    return session


@pytest.fixture(name="pgvector_session")
def pgvector_session_fixture(session: Session) -> Session:
    """The regular DB session, skipping the test when pgvector is missing.

    The schema template (`tests/utils/db.py`) installs the extension best-effort; a
    Postgres server without pgvector available skips these tests with a named
    reason instead of failing the suite (see app/AGENTS.md).
    """
    from sqlalchemy import text

    installed = session.exec(  # type: ignore[call-overload]
        text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
    ).first()
    if not installed:
        pytest.skip("pgvector extension unavailable on the test Postgres server")
    return session
