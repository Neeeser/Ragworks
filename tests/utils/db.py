"""Shared test helpers for Postgres-backed SQLModel sessions.

Isolation model: each pytest process (a plain run, or one pytest-xdist
worker) owns a dedicated database whose name encodes the worktree and the
worker id, so concurrent runs — parallel xdist workers, or two agents in
different git worktrees sharing the one dev Postgres — never touch each
other's data. Per test, the worker database is dropped and recreated from a
prebuilt template database (``CREATE DATABASE … TEMPLATE``), which Postgres
copies at the storage level in ~100ms — the same clean-slate semantics as a
schema rebuild at a fraction of the cost.

The template encodes a hash of the SQLModel metadata in its name, so a
branch that changes the schema builds (and uses) its own template instead of
poisoning another worktree's.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

from filelock import FileLock
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlmodel import Session, SQLModel, create_engine

DEFAULT_TEST_DATABASE_URL = "postgresql+psycopg://localhost:5432/ragworks_test"
"""Single source of truth for the fallback test database URL.

`tests/conftest.py` derives the per-worker database name from this (or from
`TEST_DATABASE_URL`) and seeds `DATABASE_URL` before any `app.db.*` module
loads (`app.db.engine` snapshots `DATABASE_URL` at import time).
"""

_EXTENSIONS = ("vector", "pg_search")

_template_ready = False


def worker_database_name(base_name: str) -> str:
    """Return the per-worktree, per-worker test database name.

    The worktree component keeps concurrent agents in different git
    worktrees isolated on the shared dev Postgres; the worker component
    keeps pytest-xdist workers isolated within one run.
    """
    worktree = hashlib.md5(str(Path(__file__).resolve().parents[2]).encode()).hexdigest()[:8]
    worker = os.getenv("PYTEST_XDIST_WORKER", "solo")
    return f"{base_name}_{worktree}_{worker}"


def get_database_url() -> str:
    """Return the database URL to use for tests."""
    return os.getenv("DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def create_test_engine() -> Engine:
    """Create a SQLModel engine for the test database."""
    return create_engine(get_database_url(), pool_pre_ping=True)


def _schema_hash() -> str:
    """Hash the SQLModel metadata so schema changes get their own template."""
    parts: list[str] = []
    for table in sorted(SQLModel.metadata.tables.values(), key=lambda t: t.name):
        for column in table.columns:
            parts.append(f"{table.name}.{column.name}:{column.type!s}:{column.nullable}")
    return hashlib.md5("|".join(parts).encode()).hexdigest()[:12]


def template_database_name() -> str:
    """Name of the schema-hashed template database."""
    return f"ragworks_tmpl_{_schema_hash()}"


def _admin_engine() -> Engine:
    """Autocommit engine on the server's `postgres` database for CREATE/DROP DATABASE."""
    url = make_url(get_database_url()).set(database="postgres")
    return create_engine(url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)


def _ensure_template(admin: Engine) -> None:
    """Build the template database once per schema hash, under a cross-process lock.

    The lock file lives in the system temp dir so xdist workers and parallel
    worktree runs on the same machine serialize template creation. Stale
    templates from other schema hashes are swept best-effort (an in-use
    template from another live run refuses the drop and is skipped).
    """
    template = template_database_name()
    lock = FileLock(str(Path(tempfile.gettempdir()) / f"{template}.lock"))
    with lock:
        with admin.connect() as connection:
            exists = (
                connection.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": template},
                ).first()
                is not None
            )
            if exists:
                return
            stale = connection.execute(
                text(
                    "SELECT datname FROM pg_database "
                    "WHERE datname LIKE 'ragworks_tmpl_%' AND datname != :name"
                ),
                {"name": template},
            ).all()
            for (name,) in stale:
                # In use by another run on a different schema — leave it.
                with contextlib.suppress(Exception):
                    connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            connection.execute(text(f'CREATE DATABASE "{template}"'))
        template_url = make_url(get_database_url()).set(database=template)
        template_engine = create_engine(template_url)
        try:
            for extension in _EXTENSIONS:
                try:
                    with template_engine.begin() as connection:
                        connection.execute(text(f"CREATE EXTENSION IF NOT EXISTS {extension}"))
                except Exception:  # pylint: disable=broad-exception-caught
                    pass  # extension unavailable on this server; marked tests skip
            SQLModel.metadata.create_all(template_engine)
        finally:
            # A template with open connections can't be copied from.
            template_engine.dispose()


def reset_database(engine: Engine) -> None:
    """Give this worker a fresh database copied from the schema template."""
    global _template_ready  # pylint: disable=global-statement
    database = make_url(get_database_url()).database
    engine.dispose()  # our own pooled connections would block the drop
    admin = _admin_engine()
    try:
        if not _template_ready:
            _ensure_template(admin)
            _template_ready = True
        template = template_database_name()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
            connection.execute(text(f'CREATE DATABASE "{database}" TEMPLATE "{template}"'))
    finally:
        admin.dispose()


def open_session() -> Iterator[Session]:
    """Yield a SQLModel session backed by a freshly reset test database."""
    # pylint: disable=import-outside-toplevel
    from app.services.app_config import invalidate_app_config_cache

    engine = create_test_engine()
    reset_database(engine)
    # The reset replaced the database, so pooled connections on the
    # process-wide app engine (used by `session_scope()` in background/worker
    # paths) are dead and their cached pgvector type OIDs stale. Drop the pool
    # so every test starts on fresh connections.
    from app.db.engine import engine as app_engine

    app_engine.dispose()
    invalidate_app_config_cache()
    with Session(engine) as session:
        yield session
    engine.dispose()
