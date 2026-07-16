#!/usr/bin/env python
"""Ensure a Postgres server is ready for local development.

Two modes, selected by the ``DB_MODE`` environment variable (set by the
Makefile, defaulting to ``docker`` for a bare invocation):

- ``docker``   — start the Dockerized ParadeDB database from
  ``docker-compose.dev.yml`` (pgvector + pg_search, so hybrid/BM25 search
  works). This is the standard local-dev database and the Makefile's default
  whenever no explicit URL is provided. Docker must be running; when it is not,
  the script fails loudly and points at the supported paths.
- ``external`` — the database is managed elsewhere (CI service container, a
  contributor pointing ``DATABASE_URL`` at their own server). Wait for it to
  answer and manage nothing.

External mode is a no-op when the target URL already answers. Docker mode always
reconciles its Compose service, so another listener cannot silently replace the
ParadeDB database used for development.
"""

from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy.engine.url import make_url

DEFAULT_DATABASE_URL = "postgresql+psycopg://ragworks:ragworks@localhost:54329/ragworks"
COMPOSE_FILE = Path(__file__).resolve().parent.parent / "docker-compose.dev.yml"


def _database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def _mode() -> str:
    return os.getenv("DB_MODE", "docker")


def parse_host_port(url: str) -> tuple[str, int]:
    """Return the (host, port) the given SQLAlchemy URL connects to."""
    parsed = make_url(url)
    return parsed.host or "localhost", parsed.port or 5432


def tcp_reachable(host: str, port: int, timeout: float = 1.0) -> bool:
    """Return whether a TCP connection to host:port succeeds.

    Cheaper and dependency-free versus shelling out to ``pg_isready`` — a bare
    accepted connection is enough to know the server is listening, and it works
    without Postgres client tooling installed on the host.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def docker_is_local() -> bool:
    """Return whether Docker commands target a daemon on this machine."""
    endpoint = os.getenv("DOCKER_HOST")
    if endpoint is None:
        result = subprocess.run(
            ["docker", "context", "inspect", "--format", "{{ .Endpoints.docker.Host }}"],
            check=False,
            capture_output=True,
            text=True,
        )
        endpoint = result.stdout.strip() if result.returncode == 0 else ""
    parsed = urlparse(endpoint)
    if parsed.scheme in {"unix", "npipe"}:
        return True
    return parsed.scheme == "tcp" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def docker_daemon_running() -> bool:
    """Return whether the Docker daemon is reachable (``docker info`` succeeds)."""
    result = subprocess.run(["docker", "info"], check=False, capture_output=True)
    return result.returncode == 0


def wait_reachable(host: str, port: int, attempts: int = 30, delay: float = 1.0) -> bool:
    """Poll host:port until it accepts a connection or attempts run out."""
    for _ in range(attempts):
        if tcp_reachable(host, port):
            return True
        time.sleep(delay)
    return tcp_reachable(host, port)


def _compose_up() -> None:
    """Start the dev database container and wait for it to report healthy."""
    subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "--wait", "postgres"],
        check=True,
    )


def _ensure_docker_database(host: str, port: int) -> None:
    """Reconcile the Dockerized ParadeDB dev database, failing loudly with a
    pointer to the supported paths when Docker is unusable."""
    if not docker_is_local():
        raise SystemExit(
            "Docker mode requires a local Docker daemon. Set DB_MODE=external "
            "with an addressable DATABASE_URL when using a remote Docker context."
        )
    if not docker_daemon_running():
        raise SystemExit(
            "Docker is required for local development, but its daemon isn't reachable. "
            "Start Docker, or set DATABASE_URL / TEST_DATABASE_URL to point at your own "
            "Postgres (it needs ParadeDB's pg_search for BM25/hybrid search)."
        )
    _compose_up()
    if not wait_reachable(host, port):
        raise SystemExit(f"ParadeDB dev database did not become ready on {host}:{port}.")
    print(
        f"→ ParadeDB dev database ready on {host}:{port} "
        "(pgvector + pg_search / BM25 enabled)."
    )


def ensure_postgres() -> None:
    """Ensure the configured Postgres is ready, per DB_MODE."""
    host, port = parse_host_port(_database_url())
    mode = _mode()

    if mode == "docker":
        _ensure_docker_database(host, port)
        return

    # external: the server is managed elsewhere (CI service container, a
    # contributor's own Postgres). Never start anything — just wait for it.
    if tcp_reachable(host, port):
        return
    if not wait_reachable(host, port):
        raise SystemExit(f"Postgres did not become ready on {host}:{port}.")


if __name__ == "__main__":
    ensure_postgres()
