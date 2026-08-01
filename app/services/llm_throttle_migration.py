"""Startup migration: stamp LLM throttle defaults onto connection rows.

Existing chat-capable provider connections predate the throttle settings,
so their rows carry neither `max_concurrent_requests` nor
`requests_per_minute`. The runtime falls back to the adapter defaults
either way, but a stamped value is what the edit dialog shows and what
survives a future change to the shipped defaults — the row states what the
connection actually runs with. Idempotent by key presence: a value the
user later edits (or clears through the form, which stores an explicit
value) is never overwritten.
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from app.db import models
from app.providers.registry import ADAPTERS
from app.schemas.enums import ProviderKind, ProviderType

logger = logging.getLogger(__name__)


def stamp_llm_throttle_defaults(session: Session) -> None:
    """Write per-provider throttle defaults into rows that carry none."""
    stamped = 0
    for connection in session.exec(select(models.ProviderConnection)).all():
        try:
            provider_type = ProviderType(connection.provider_type)
        except ValueError:
            continue
        adapter_cls = ADAPTERS.get(provider_type)
        if adapter_cls is None or ProviderKind.CHAT not in adapter_cls.descriptor.kinds:
            continue
        config = dict(connection.config or {})
        changed = False
        if "max_concurrent_requests" not in config:
            config["max_concurrent_requests"] = adapter_cls.default_llm_concurrency
            changed = True
        if "requests_per_minute" not in config and adapter_cls.default_llm_rpm is not None:
            config["requests_per_minute"] = adapter_cls.default_llm_rpm
            changed = True
        if not changed:
            continue
        # Reassign, never mutate in place: the JSON column only registers a
        # new object as a change.
        connection.config = config
        session.add(connection)
        stamped += 1
    if stamped:
        session.commit()
        logger.info("Stamped LLM throttle defaults onto %s connection(s).", stamped)
