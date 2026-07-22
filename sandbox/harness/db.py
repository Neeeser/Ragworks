"""Reset and initialize the dedicated sandbox database.

The sandbox database (`ragworks_sandbox`) lives on the same ParadeDB dev server as
the dev and test databases; dropping and recreating it is how every seed
starts from a known state. Schema comes from the app's own `init_db` (tables,
migrations, extensions) — never a parallel definition.
"""

from __future__ import annotations

import subprocess
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url

from sandbox.config import REPO_ROOT, database_url, maintenance_database_url


def ensure_server() -> None:
    """Start (or wait for) the ParadeDB dev server via the existing script."""
    subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "ensure_postgres.py")],
        check=True,
        env=_ensure_env(),
    )


def _ensure_env() -> dict[str, str]:
    import os

    env = dict(os.environ)
    env["DATABASE_URL"] = database_url()
    env.setdefault("DB_MODE", "docker")
    return env


def reset_database() -> None:
    """Drop and recreate the sandbox database, disconnecting any stale sessions."""
    name = make_url(database_url()).database
    engine = create_engine(maintenance_database_url(), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        engine.dispose()


def init_schema() -> None:
    """Create tables, run migrations, and install extensions via the app.

    Imports lazily: `app.db.engine` binds `DATABASE_URL` at import time, so
    the caller must have applied the sandbox environment first.
    """
    from app.db.bootstrap import init_db

    init_db()
