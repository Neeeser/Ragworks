"""Shared helpers for creating provider connections in tests."""

from __future__ import annotations

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


def install_default_pipelines(
    session: Session,
    user: models.User,
    connection: models.ProviderConnection | None = None,
    *,
    embedding_model: str = "test-embed",
) -> models.ProviderConnection:
    """Install default pipelines the way the setup wizard would.

    Global default models are gone, so tests that exercise flows which expect
    defaults (collection create, ingestion, retrieval) install them around an
    explicit connection + model first. Returns the embedding connection.
    """
    from app.pipelines.defaults import (
        build_default_ingestion_pipeline,
        build_default_retrieval_pipeline,
    )
    from app.services.pipelines import (
        DEFAULT_INGEST_SLUG,
        DEFAULT_SEARCH_SLUG,
        PipelineService,
    )

    resolved = connection or add_openrouter_connection(session, user)
    service = PipelineService(session)
    service.create_pipeline(
        user=user,
        name="Default Ingestion Pipeline",
        description="Baseline ingestion pipeline for uploads.",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=resolved.id, embedding_model=embedding_model
        ),
        change_summary="Test scaffold.",
        template_slug=DEFAULT_INGEST_SLUG,
    )
    service.create_pipeline(
        user=user,
        name="Default Retrieval Pipeline",
        description="Baseline retrieval pipeline for queries.",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=resolved.id, embedding_model=embedding_model
        ),
        change_summary="Test scaffold.",
        template_slug=DEFAULT_SEARCH_SLUG,
    )
    session.commit()
    return resolved
