"""Behavior of the dev database readiness script's pure decision logic.

The mode-selection contract (docker/native/external, and the no-op when the DB
already answers) is where a regression would silently point `make run`/`make
test` at the wrong Postgres, so it is pinned here without touching Docker or a
real server.
"""

from __future__ import annotations

import pytest

from scripts.ensure_postgres import parse_host_port, plan_action


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


def test_already_reachable_is_noop_in_every_mode() -> None:
    for mode in ("docker", "native", "external"):
        assert plan_action(mode, reachable=True) == "noop"


def test_docker_mode_starts_the_container_when_unreachable() -> None:
    assert plan_action("docker", reachable=False) == "docker"


def test_native_mode_starts_local_postgres_when_unreachable() -> None:
    assert plan_action("native", reachable=False) == "native"


def test_external_mode_only_waits_and_never_manages() -> None:
    # CI service container / a contributor's own server: never start anything,
    # just wait for it to answer.
    assert plan_action("external", reachable=False) == "wait"
