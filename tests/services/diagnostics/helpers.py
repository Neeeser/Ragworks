"""Helpers for building `DiagnosticContext`s in rule unit tests.

Rules read a resolved `DiagnosticContext`; these helpers build one with real
resolved settings (so field shapes match production) that a test then tweaks
with `dataclasses.replace` to create the exact mismatch under test.
"""

from __future__ import annotations

import dataclasses
from uuid import uuid4

from app.db import models
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.registry import default_registry
from app.pipelines.settings import (
    PipelineSettings,
    resolve_pipeline_settings,
)
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.prober import ProbeUnavailable
from app.vectorstores.base import IndexStats

EMBED_MODEL = "test-embed"
CONNECTION_ID = uuid4()


class StubProber:
    """Configurable stand-in for `VectorStoreProber` in rule tests."""

    def __init__(self, stats: IndexStats | None = None, *, unavailable: bool = False) -> None:
        self._stats = stats or IndexStats(exists=True, count=10)
        self._unavailable = unavailable
        self.calls: list[tuple[object, str, str | None]] = []

    def stats(self, backend: object, index: str, namespace: str | None = None) -> IndexStats:
        """Record the probe and return the configured stats (or raise)."""
        self.calls.append((backend, index, namespace))
        if self._unavailable:
            raise ProbeUnavailable("stub store unreachable")
        return self._stats


def _collection() -> models.Collection:
    return models.Collection(user_id=uuid4(), name="Docs", description="", extra_metadata={})


def _base_ingestion() -> PipelineSettings:
    definition = build_default_ingestion_pipeline(
        embedding_connection_id=CONNECTION_ID, embedding_model=EMBED_MODEL
    )
    return resolve_pipeline_settings(definition, _collection(), default_registry())


def _base_retrieval() -> PipelineSettings:
    definition = build_default_retrieval_pipeline(
        embedding_connection_id=CONNECTION_ID, embedding_model=EMBED_MODEL
    )
    return resolve_pipeline_settings(definition, _collection(), default_registry())


@dataclasses.dataclass
class _ResolvedStub:
    """Minimal stand-in for a Resolved{Ingestion,Retrieval}Pipeline."""

    settings: object
    pipeline: models.Pipeline


def make_context(
    *,
    ingestion: PipelineSettings | None = None,
    retrieval: PipelineSettings | None = None,
    prober: StubProber | None = None,
    ingestion_validation: object | None = None,
    retrieval_validation: object | None = None,
    recent_ingestion_failures: list[models.PipelineRun] | None = None,
    recent_retrieval_failures: list[models.PipelineRun] | None = None,
) -> DiagnosticContext:
    """Build a `DiagnosticContext` with the given resolved sides.

    Pass `None` for a side to leave it unresolved (the `*_settings` property
    returns `None`, exercising the tolerate-missing-side path).
    """
    collection = _collection()
    ctx = DiagnosticContext(
        collection=collection,
        user=models.User(email="u@example.com", full_name="U", hashed_password="x"),
        session=None,  # type: ignore[arg-type]  # rules under test never touch the session
        prober=prober or StubProber(),  # type: ignore[arg-type]
    )
    if ingestion is not None:
        ctx.ingestion = _ResolvedStub(  # type: ignore[assignment]
            settings=ingestion,
            pipeline=models.Pipeline(
                user_id=collection.user_id, name="Ingestion", kind=models.PipelineKind.INGESTION
            ),
        )
    if retrieval is not None:
        ctx.retrieval = _ResolvedStub(  # type: ignore[assignment]
            settings=retrieval,
            pipeline=models.Pipeline(
                user_id=collection.user_id, name="Retrieval", kind=models.PipelineKind.RETRIEVAL
            ),
        )
    ctx.ingestion_validation = ingestion_validation  # type: ignore[assignment]
    ctx.retrieval_validation = retrieval_validation  # type: ignore[assignment]
    ctx.recent_ingestion_failures = recent_ingestion_failures or []
    ctx.recent_retrieval_failures = recent_retrieval_failures or []
    return ctx


def base_ingestion_settings() -> PipelineSettings:
    """Resolved default ingestion settings tests tweak with `replace`."""
    return _base_ingestion()


def base_retrieval_settings() -> PipelineSettings:
    """Resolved default retrieval settings tests tweak with `replace`."""
    return _base_retrieval()
