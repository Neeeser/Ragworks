"""Shared test helpers for Postgres-backed SQLModel sessions."""

from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

DEFAULT_TEST_DATABASE_URL = "postgresql+psycopg://localhost:5432/ragworks_test"
"""Single source of truth for the fallback test database URL.

`tests/conftest.py` imports this constant to seed `DATABASE_URL` before any
`app.db.*` module loads (`app.db.engine` snapshots `DATABASE_URL` at import
time). `app.db.bootstrap` is imported lazily inside `open_session` below,
not at module scope, so importing this module early — before that env var is
set — can't accidentally trigger `app.db.engine`'s import-time engine
creation against the wrong URL.
"""


def get_database_url() -> str:
    """Return the database URL to use for tests."""
    return os.getenv("DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def create_test_engine() -> Engine:
    """Create a SQLModel engine for the test database."""
    return create_engine(get_database_url(), pool_pre_ping=True)


def reset_database(engine: Engine) -> None:
    """Drop and recreate all tables for a clean test database."""
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    # Dropping `public` cascade removes the extensions' objects, so re-install
    # them best-effort; extension-marked tests skip when unavailable.
    for extension in ("vector", "pg_search"):
        try:
            with engine.begin() as connection:
                connection.execute(text(f"CREATE EXTENSION IF NOT EXISTS {extension}"))
        except Exception:  # pylint: disable=broad-exception-caught
            pass
    SQLModel.metadata.create_all(engine)


def open_session() -> Iterator[Session]:
    """Yield a SQLModel session backed by a reset test database."""
    # pylint: disable=import-outside-toplevel
    from app.db.bootstrap import ensure_database_exists
    from app.services.app_config import invalidate_app_config_cache

    ensure_database_exists(get_database_url())
    engine = create_test_engine()
    reset_database(engine)
    # The schema reset re-creates the pgvector type with a new OID; pooled
    # connections on the process-wide app engine (used by `session_scope()` in
    # background/worker paths) cache the old OID and fail with "cache lookup
    # failed for type" on their next vector bind. Drop the pool so every test
    # starts on fresh connections.
    from app.db.engine import engine as app_engine

    app_engine.dispose()
    invalidate_app_config_cache()
    with Session(engine) as session:
        yield session
