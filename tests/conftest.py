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
from sqlmodel import Session

from tests.utils.db import DEFAULT_TEST_DATABASE_URL, open_session

TEST_ROOT = Path(__file__).resolve().parent / ".artifacts"
STORAGE_PATH = TEST_ROOT / "storage"
CONFIG_PATH = TEST_ROOT / "config"


def _prepare_environment() -> None:
    """Redirect the suite at an isolated database and storage path.

    Postgres is required (many tests hit a real `session` fixture) but no
    live OpenRouter/Pinecone credentials are needed — provider boundaries
    are stubbed.
    """
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    if STORAGE_PATH.exists():
        shutil.rmtree(STORAGE_PATH)

    os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
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


@pytest.fixture(name="pgvector_session")
def pgvector_session_fixture(session: Session) -> Session:
    """The regular DB session, skipping the test when pgvector is missing.

    `tests/utils/db.reset_database` installs the extension best-effort; a
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
