"""Regression coverage for Makefile database URL resolution."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATABASE_VARIABLES = ("DATABASE_URL", "TEST_DATABASE_URL")
EXTERNAL_URL = "postgresql+psycopg://user:password@example.invalid:5432/ragworks"
EXTERNAL_TEST_URL = "postgresql+psycopg://user:password@example.invalid:5432/ragworks_test"


def _dry_run(target: str, **variables: str) -> str:
    environment = {key: value for key, value in os.environ.items() if key not in DATABASE_VARIABLES}
    environment.update(variables)
    result = subprocess.run(
        ["make", "--no-print-directory", "-n", target],
        cwd=ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def test_database_url_override_leaves_test_url_resolved() -> None:
    output = _dry_run("test", DATABASE_URL=EXTERNAL_URL)

    assert 'TEST_DATABASE_URL=""' not in output
    assert "TEST_DATABASE_URL=" in output


def test_test_database_url_override_leaves_server_url_resolved() -> None:
    output = _dry_run("server", TEST_DATABASE_URL=EXTERNAL_TEST_URL)

    assert 'DATABASE_URL=""' not in output
    assert "DATABASE_URL=" in output


def test_external_server_url_is_used_by_server() -> None:
    output = _dry_run("server", DATABASE_URL=EXTERNAL_URL)

    assert f'DATABASE_URL="{EXTERNAL_URL}"' in output


def test_external_test_url_is_used_by_tests() -> None:
    output = _dry_run("test", TEST_DATABASE_URL=EXTERNAL_TEST_URL)

    assert f'TEST_DATABASE_URL="{EXTERNAL_TEST_URL}"' in output
