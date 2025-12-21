#!/usr/bin/env python
"""Ensure a Postgres server is running for local development."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from typing import Optional

from sqlalchemy.engine.url import make_url

DEFAULT_DATABASE_URL = "postgresql+psycopg://localhost:5432/transparentrag"
DEFAULT_DATA_DIRS = [
    "/opt/homebrew/var/postgresql@17",
    "/usr/local/var/postgresql@17",
    "/var/lib/postgresql/data",
    "/var/lib/postgresql/17/main",
]


def _database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def _candidate_data_dir() -> Optional[str]:
    env_dir = os.getenv("POSTGRES_DATA_DIR")
    if env_dir:
        return env_dir
    for candidate in DEFAULT_DATA_DIRS:
        if os.path.isdir(candidate):
            return candidate
    return None


def _pg_is_ready(host: str, port: int, pg_isready: str) -> bool:
    result = subprocess.run(
        [pg_isready, "-h", host, "-p", str(port)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def _start_postgres(data_dir: str) -> None:
    start_command = os.getenv("POSTGRES_START_COMMAND")
    if start_command:
        subprocess.run(start_command, shell=True, check=True)
        return
    log_file = os.getenv("POSTGRES_LOG_FILE") or os.path.join(data_dir, "server.log")
    subprocess.run(["pg_ctl", "-D", data_dir, "-l", log_file, "start"], check=True)


def ensure_postgres() -> None:
    """Ensure Postgres is ready for connections."""
    url = make_url(_database_url())
    host = url.host or "localhost"
    port = url.port or 5432

    pg_isready = shutil.which("pg_isready")
    if pg_isready and _pg_is_ready(host, port, pg_isready):
        return

    data_dir = _candidate_data_dir()
    if not data_dir:
        raise SystemExit(
            "Postgres is not running and POSTGRES_DATA_DIR is not set. "
            "Set POSTGRES_DATA_DIR or POSTGRES_START_COMMAND."
        )

    if not pg_isready:
        status = subprocess.run(
            ["pg_ctl", "-D", data_dir, "status"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if status.returncode == 0:
            return

    _start_postgres(data_dir)

    for _ in range(10):
        if pg_isready and _pg_is_ready(host, port, pg_isready):
            return
        time.sleep(0.5)

    raise SystemExit("Postgres did not become ready after starting.")


if __name__ == "__main__":
    ensure_postgres()
