"""Shared helpers for creating provider connections in tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlmodel import Session

from app.db import models

TEST_EMBED_CONNECTION_ID = uuid4()


def add_connection(
    session: Session,
    user: models.User,
    provider_type: str,
    config: dict[str, Any],
    label: str | None = None,
) -> models.ProviderConnection:
    """Persist a provider connection for a user and return it."""
    connection = models.ProviderConnection(
        user_id=user.id,
        provider_type=provider_type,
        label=label or provider_type,
        config=config,
    )
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


def add_openrouter_connection(
    session: Session, user: models.User, api_key: str = "openrouter-key"
) -> models.ProviderConnection:
    """Persist an OpenRouter connection for a user."""
    return add_connection(
        session, user, "openrouter", {"api_key": api_key}, label="OpenRouter"
    )


def add_pinecone_connection(
    session: Session, user: models.User, api_key: str = "pinecone-key"
) -> models.ProviderConnection:
    """Persist a Pinecone connection for a user."""
    return add_connection(
        session, user, "pinecone", {"api_key": api_key}, label="Pinecone"
    )


@dataclass(frozen=True)
class ScaffoldedPipelines:
    """The hybrid pair a test installed, plus the connection they embed with."""

    connection: models.ProviderConnection
    ingestion: models.Pipeline
    retrieval: models.Pipeline


def install_scaffolded_pipelines(
    session: Session,
    user: models.User,
    connection: models.ProviderConnection | None = None,
    *,
    embedding_model: str = "test-embed",
    expose_slots: bool = False,
) -> ScaffoldedPipelines:
    """Install the hybrid pair the way the setup wizard would.

    Nothing scaffolds pipelines on a user's behalf at run time, so a test
    exercising a flow that needs a bound collection (create, ingestion,
    retrieval) installs them here first, around an explicit connection and
    model. Idempotent: a second call returns the pipelines the first
    installed, so a test may call it without knowing what a fixture did.

    Index registration runs here for the same reason the wizard runs it: an
    index a scaffolded pipeline names must exist as a selectable entity. It
    stays named in the graph, which is the shape the product produces —
    exposing it as a collection-filled slot is a deliberate authoring step
    (`expose_index_slots`), never something scaffolding does on its own.
    """
    from app.pipelines.defaults import (
        build_default_ingestion_pipeline,
        build_default_retrieval_pipeline,
    )
    from app.pipelines.definition import PipelineDefinition
    from app.services.index_scaffolding import register_definition_indexes
    from app.services.pipelines import (
        DEFAULT_INGEST_SLUG,
        DEFAULT_SEARCH_SLUG,
        PipelineService,
    )
    from tests.utils.pipelines import expose_index_slots

    resolved = connection or add_openrouter_connection(session, user)
    service = PipelineService(session)

    def prepare(definition: PipelineDefinition) -> PipelineDefinition:
        """Register the definition's indexes, optionally exposing them as slots."""
        registered = register_definition_indexes(session, user, definition)
        return expose_index_slots(session, user, registered) if expose_slots else registered

    ingestion = service.get_by_template_slug(user.id, DEFAULT_INGEST_SLUG)
    if ingestion is None:
        ingestion = service.create_pipeline(
            user=user,
            name="Hybrid Ingestion",
            description="Chunks and embeds uploads into semantic and BM25 indexes.",
            definition=prepare(
                build_default_ingestion_pipeline(
                    embedding_connection_id=resolved.id, embedding_model=embedding_model
                )
            ),
            change_summary="Test scaffold.",
            template_slug=DEFAULT_INGEST_SLUG,
        )
    retrieval = service.get_by_template_slug(user.id, DEFAULT_SEARCH_SLUG)
    if retrieval is None:
        retrieval = service.create_pipeline(
            user=user,
            name="Hybrid Search",
            description="Semantic and BM25 retrieval fused by reciprocal rank.",
            definition=prepare(
                build_default_retrieval_pipeline(
                    embedding_connection_id=resolved.id, embedding_model=embedding_model
                )
            ),
            change_summary="Test scaffold.",
            template_slug=DEFAULT_SEARCH_SLUG,
        )
    session.commit()
    return ScaffoldedPipelines(connection=resolved, ingestion=ingestion, retrieval=retrieval)
