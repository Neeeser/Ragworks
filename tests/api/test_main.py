"""Tests for `configure_logging`, a pure function extracted from import-time setup.

Import-time logging configuration used to require reloading `app.api.main` to
exercise (see removed `test_main_logging.py`); it is now a plain function
called from `lifespan`, so it is testable directly.
"""

from __future__ import annotations

import asyncio
import logging

from app.api import main as main_module
from app.api.main import configure_logging


def test_configure_logging_sets_level_when_name_given(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    def _basic_config(**kwargs):
        recorded.update(kwargs)

    monkeypatch.setattr(logging, "basicConfig", _basic_config)

    configure_logging("debug")

    assert recorded["level"] == logging.DEBUG
    assert "format" in recorded
    assert logging.getLogger("uvicorn").level == logging.DEBUG


def test_configure_logging_is_noop_when_name_blank(monkeypatch) -> None:
    def _basic_config(**_kwargs):
        raise AssertionError("basicConfig should not be called for a blank level")

    monkeypatch.setattr(logging, "basicConfig", _basic_config)

    configure_logging("")


def test_lifespan_closes_provider_clients(monkeypatch) -> None:
    for name in (
        "configure_logging",
        "init_db",
        "migrate_provider_connections",
        "migrate_tokenizer_nodes",
        "upgrade_stored_pipeline_definitions",
        "backfill_default_pipelines",
        "backfill_file_nodes",
        "ensure_admin_exists",
        "purge_expired_telemetry",
    ):
        monkeypatch.setattr(main_module, name, lambda *_args, **_kwargs: None)
    closed: list[bool] = []
    monkeypatch.setattr(
        main_module, "close_provider_clients", lambda: closed.append(True)
    )

    async def _exercise() -> None:
        async with main_module.lifespan(main_module.app):
            assert closed == []

    asyncio.run(_exercise())

    assert closed == [True]
