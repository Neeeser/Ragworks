"""Tests for logging configuration and the app lifespan.

`configure_logging` now lives in `app.observability` (structured JSON to
stdout); `app.api.main` re-imports it and calls it from `lifespan`. The
pipeline's own behavior is pinned in `tests/observability/`; here we assert the
level resolution and that the lifespan wires it.
"""

from __future__ import annotations

import asyncio
import logging

from app.api import main as main_module
from app.api.main import configure_logging


def test_configure_logging_sets_level_from_name() -> None:
    configure_logging("debug", debug=False)
    assert logging.getLogger().level == logging.DEBUG
    # Reset to a sane default so a debug level does not leak into later tests.
    configure_logging("INFO", debug=False)


def test_configure_logging_defaults_to_info_when_blank() -> None:
    configure_logging("", debug=False)
    assert logging.getLogger().level == logging.INFO


def test_lifespan_closes_provider_clients(monkeypatch) -> None:
    for name in (
        "configure_logging",
        "init_db",
        "run_startup_migrations",
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
