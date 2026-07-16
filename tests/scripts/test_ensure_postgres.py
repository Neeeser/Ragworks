"""Behavior of the dev database readiness script.

The mode-selection contract (docker vs. external, and the loud failure when
Docker is unusable) is where a regression would silently point `make run`/`make
test` at the wrong Postgres — or worse, at a BM25-less server — so it is pinned
here without touching a real Docker daemon or Postgres.
"""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from scripts import ensure_postgres as postgres
from scripts.ensure_postgres import COMPOSE_FILE, parse_host_port


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgresql+psycopg://ragworks:ragworks@localhost:54329/ragworks", ("localhost", 54329)),
        ("postgresql+psycopg://postgres:postgres@db:5432/ragworks_test", ("db", 5432)),
        ("postgresql+psycopg:///ragworks", ("localhost", 5432)),
    ],
)
def test_parse_host_port(url: str, expected: tuple[str, int]) -> None:
    assert parse_host_port(url) == expected


def test_dev_compose_binds_postgres_to_loopback() -> None:
    """The native app needs a local port, not a network-exposed database."""
    assert '"127.0.0.1:54329:5432"' in COMPOSE_FILE.read_text()


def test_docker_mode_reconciles_compose_before_waiting_for_postgres(monkeypatch) -> None:
    compose_up = Mock()
    monkeypatch.setenv("DB_MODE", "docker")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://localhost:54329/ragworks")
    monkeypatch.setattr(postgres, "docker_is_local", lambda: True, raising=False)
    monkeypatch.setattr(postgres, "docker_daemon_running", lambda: True, raising=False)
    monkeypatch.setattr(postgres, "tcp_reachable", lambda *_: True)
    monkeypatch.setattr(postgres, "_compose_up", compose_up)

    postgres.ensure_postgres()

    compose_up.assert_called_once_with()


def test_docker_mode_rejects_a_remote_daemon(monkeypatch) -> None:
    monkeypatch.setenv("DB_MODE", "docker")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://localhost:54329/ragworks")
    monkeypatch.setattr(postgres, "docker_is_local", lambda: False, raising=False)
    monkeypatch.setattr(postgres, "tcp_reachable", lambda *_: True)

    with pytest.raises(SystemExit, match="local Docker daemon"):
        postgres.ensure_postgres()


def test_docker_mode_fails_loudly_when_daemon_is_down(monkeypatch) -> None:
    """Docker down with no explicit URL is a hard, guided stop — never a silent
    start against a BM25-less server."""
    compose_up = Mock()
    monkeypatch.setenv("DB_MODE", "docker")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://localhost:54329/ragworks")
    monkeypatch.setattr(postgres, "docker_is_local", lambda: True, raising=False)
    monkeypatch.setattr(postgres, "docker_daemon_running", lambda: False, raising=False)
    monkeypatch.setattr(postgres, "_compose_up", compose_up)

    with pytest.raises(SystemExit, match="Docker is required for local development"):
        postgres.ensure_postgres()

    compose_up.assert_not_called()


def test_external_mode_is_a_noop_when_already_reachable(monkeypatch) -> None:
    """A managed DB (CI service container, own server) is never started."""
    compose_up = Mock()
    monkeypatch.setenv("DB_MODE", "external")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pw@example.invalid:5432/ragworks")
    monkeypatch.setattr(postgres, "tcp_reachable", lambda *_: True)
    monkeypatch.setattr(postgres, "_compose_up", compose_up)

    postgres.ensure_postgres()

    compose_up.assert_not_called()


def test_external_mode_errors_when_the_server_never_answers(monkeypatch) -> None:
    monkeypatch.setenv("DB_MODE", "external")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pw@example.invalid:5432/ragworks")
    monkeypatch.setattr(postgres, "tcp_reachable", lambda *_: False)
    monkeypatch.setattr(postgres, "wait_reachable", lambda *_a, **_k: False)

    with pytest.raises(SystemExit, match="did not become ready"):
        postgres.ensure_postgres()


@pytest.mark.parametrize("endpoint", ["tcp://127.0.0.1:2375", "tcp://localhost:2375"])
def test_local_tcp_docker_endpoints_are_supported(monkeypatch, endpoint: str) -> None:
    monkeypatch.setenv("DOCKER_HOST", endpoint)

    assert postgres.docker_is_local()
