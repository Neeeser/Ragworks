"""Startup migration: stamp request-throttle defaults onto connection rows.

Existing model-serving provider connections (chat, embedding, reranking)
predate the throttle settings, so their rows carry no
`max_concurrent_requests`/`requests_per_minute` values. The runtime falls
back to the adapter defaults either way, but a stamped value is what the
edit dialog shows and what survives a future change to the shipped
defaults — the row states what the connection actually runs with.
Idempotent by key presence: a value the user later edits is never
overwritten. Per-kind pace defaults are stamped only where the provider
ships one (OpenAI/Cohere embeddings, Cohere rerank) — an absent key
otherwise keeps meaning "draw from the shared window".
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from app.db import models
from app.providers.registry import ADAPTERS
from app.schemas.enums import ProviderKind, ProviderType

logger = logging.getLogger(__name__)

_MODEL_KINDS = frozenset({ProviderKind.CHAT, ProviderKind.EMBEDDING, ProviderKind.RERANKING})


def stamp_llm_throttle_defaults(session: Session) -> None:
    """Write per-provider throttle defaults into rows that carry none."""
    stamped = 0
    for connection in session.exec(select(models.ProviderConnection)).all():
        try:
            provider_type = ProviderType(connection.provider_type)
        except ValueError:
            continue
        adapter_cls = ADAPTERS.get(provider_type)
        if adapter_cls is None or not (_MODEL_KINDS & set(adapter_cls.descriptor.kinds)):
            continue
        config = dict(connection.config or {})
        changed = False
        defaults: list[tuple[str, int | None]] = [
            ("max_concurrent_requests", adapter_cls.default_request_concurrency),
            ("requests_per_minute", adapter_cls.default_request_rpm),
            ("embedding_requests_per_minute", adapter_cls.default_embedding_rpm),
            ("rerank_requests_per_minute", adapter_cls.default_rerank_rpm),
        ]
        for key, default in defaults:
            if default is not None and key not in config:
                config[key] = default
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
