"""Shared fixtures for the unit test suite.

Only environment bootstrapping and the function-scoped `session` fixture live
here. Live-credential fixtures (real OpenRouter/Pinecone calls) belong in
`tests/integration/conftest.py` so the unit suite can collect and run without
any `TEST_*` credentials configured.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlmodel import Session

from tests.utils.db import DEFAULT_TEST_DATABASE_URL, open_session

TEST_ROOT = Path(__file__).resolve().parent / ".integration"
STORAGE_PATH = TEST_ROOT / "storage"
ENV_FILES = [Path(".env"), Path(".env.local")]


def _load_env_files() -> None:
    """Populate os.environ defaults from .env/.env.local, if present.

    Uses setdefault semantics only: a value already present in the
    environment (e.g. set by CI) always wins over the file.
    """
    for env_path in ENV_FILES:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def _prepare_environment() -> None:
    """Redirect the unit suite at an isolated database and storage path.

    Postgres is still required to run the unit suite (many tests hit a real
    `session` fixture) but no live OpenRouter/Pinecone credentials are
    needed here — those are gated in `tests/integration/conftest.py`.
    """
    _load_env_files()

    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    if STORAGE_PATH.exists():
        shutil.rmtree(STORAGE_PATH)

    os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    os.environ["FILE_STORAGE_PATH"] = str(STORAGE_PATH)


_prepare_environment()

from app.core import config as api_config  # noqa: E402

api_config.get_settings.cache_clear()

import app.db.models  # noqa: E402,F401  # register SQLModel metadata before any reset


@pytest.fixture(name="session")
def session_fixture() -> Generator[Session, None, None]:
    yield from open_session()
