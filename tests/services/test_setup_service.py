"""SetupService: first-run status derivation and one-shot bootstrap.

Status is derived from real state (provider-kind coverage + index +
collection), never a stored flag. Bootstrap installs the wizard's default
pipelines around the explicit (connection, model) choice and creates the
first collection — there are no global default models to seed.
"""

from __future__ import annotations

from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.schemas.enums import IndexBackend
from app.schemas.indexes import IndexCreateRequest
from app.schemas.setup import SetupBootstrapRequest
from app.services.app_config import invalidate_app_config_cache
from app.services.errors import InvalidInputError, NotFoundError
from app.services.index_admin import IndexAdminService
from app.services.setup import SetupService
from tests.utils.providers import add_connection, add_openrouter_connection


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="setup@example.com",
        full_name="Setup User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_pgvector_index(session: Session, user: models.User, *, dimension: int = 384) -> None:
    IndexAdminService(session).create_index(
        user,
        IndexCreateRequest(
            name="first-index",
            backend=IndexBackend.PGVECTOR,
            dimension=dimension,
            metric="cosine",
        ),
    )


def _bootstrap_request(
    connection: models.ProviderConnection, **overrides: object
) -> SetupBootstrapRequest:
    payload: dict[str, object] = {
        "embedding_connection_id": str(connection.id),
        "embedding_model": "sentence-transformers/all-minilm-l6-v2",
        "embedding_dimension": 384,
        "backend": "pgvector",
        "index_name": "first-index",
        "collection_name": "My first collection",
    }
    payload.update(overrides)
    return SetupBootstrapRequest.model_validate(payload)


def test_status_reports_missing_pieces(session: Session) -> None:
    user = _create_user(session)

    status = SetupService(session).status(user)

    assert status.has_embedding_provider is False
    assert status.has_chat_provider is False
    # pgvector counts as a vector store when the extension is present.
    assert status.has_vector_store is True
    assert status.has_index is False
    assert status.has_collection is False
    assert status.setup_complete is False


def test_status_complete_when_providers_index_and_collection_exist(
    pgvector_session: Session,
) -> None:
    session = pgvector_session
    user = _create_user(session)
    add_openrouter_connection(session, user)
    _create_pgvector_index(session, user)
    session.add(
        models.Collection(user_id=user.id, name="c", description="", extra_metadata={})
    )
    session.commit()

    status = SetupService(session).status(user)

    assert status.has_embedding_provider is True
    assert status.has_chat_provider is True
    assert status.has_vector_store is True
    assert status.has_index is True
    assert status.has_collection is True
    assert status.setup_complete is True


def test_status_complete_without_a_reranking_provider(
    pgvector_session: Session,
) -> None:
    """Reranking is optional: an embedding+chat provider finishes setup.

    Regression: adding ``ProviderKind.RERANKING`` silently strengthened the
    ``all(ProviderKind)`` readiness gate, so an Ollama-only user was bounced
    back to the setup wizard on every page load after finishing it.
    """
    session = pgvector_session
    user = _create_user(session)
    add_connection(
        session, user, "ollama", {"base_url": "http://localhost:11434"}, label="Ollama"
    )
    _create_pgvector_index(session, user)
    session.add(
        models.Collection(user_id=user.id, name="c", description="", extra_metadata={})
    )
    session.commit()

    status = SetupService(session).status(user)

    assert status.has_embedding_provider is True
    assert status.has_chat_provider is True
    assert status.setup_complete is True


def test_bootstrap_creates_default_pipelines_and_first_collection(
    pgvector_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = pgvector_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    _create_pgvector_index(session, user)

    monkeypatch.setattr(
        "app.providers.openrouter.OpenRouterAdapter.embedding_input_limit",
        lambda _adapter, _model: 512,
    )
    result = SetupService(session).bootstrap(user, _bootstrap_request(connection))
    collection = result.collection

    assert result.warnings == []

    with Session(session.get_bind()) as fresh:
        pipelines = fresh.exec(select(models.Pipeline)).all()
        stored = fresh.get(models.Collection, collection.id)
        assert stored is not None
        assert stored.name == "My first collection"
        kinds = {pipeline.kind for pipeline in pipelines if pipeline.is_default}
        assert kinds == {models.PipelineKind.INGESTION, models.PipelineKind.RETRIEVAL}
        assert stored.ingestion_pipeline_id is not None
        assert stored.retrieval_pipeline_id is not None
        assert fresh.exec(select(models.PipelineVersion)).first() is not None


def test_bootstrap_writes_wizard_choices_into_pipelines(
    pgvector_session: Session,
) -> None:
    session = pgvector_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    _create_pgvector_index(session, user)

    SetupService(session).bootstrap(user, _bootstrap_request(connection, chunk_size=512))

    with Session(session.get_bind()) as fresh:
        versions = fresh.exec(select(models.PipelineVersion)).all()
    definitions = [version.definition for version in versions]
    embedders = [
        node
        for definition in definitions
        for node in definition["nodes"]
        if node["type"] == "embedder.text"
    ]
    assert embedders
    assert all(
        node["config"]["model_name"] == "sentence-transformers/all-minilm-l6-v2"
        for node in embedders
    )
    assert all(
        node["config"]["connection_id"] == str(connection.id) for node in embedders
    )
    chunkers = [
        node
        for definition in definitions
        for node in definition["nodes"]
        if node["id"] == "chunk-document"
    ]
    assert chunkers[0]["config"] == {"chunk_size": 356, "chunk_overlap": 140}


def test_bootstrap_rejects_missing_index(session: Session) -> None:
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)

    with pytest.raises(InvalidInputError):
        SetupService(session).bootstrap(user, _bootstrap_request(connection))


def test_bootstrap_rejects_foreign_or_missing_connection(
    pgvector_session: Session,
) -> None:
    """The embedding connection must exist and belong to the bootstrapping user."""
    session = pgvector_session
    user = _create_user(session)
    _create_pgvector_index(session, user)
    payload = SetupBootstrapRequest.model_validate(
        {
            "embedding_connection_id": str(uuid4()),
            "embedding_model": "sentence-transformers/all-minilm-l6-v2",
            "embedding_dimension": 384,
            "backend": "pgvector",
            "index_name": "first-index",
            "collection_name": "My first collection",
        }
    )

    with pytest.raises(NotFoundError):
        SetupService(session).bootstrap(user, payload)


def test_bootstrap_rejects_dimension_mismatch(pgvector_session: Session) -> None:
    session = pgvector_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    _create_pgvector_index(session, user, dimension=768)

    with pytest.raises(InvalidInputError, match="dimension"):
        SetupService(session).bootstrap(
            user, _bootstrap_request(connection, embedding_dimension=384)
        )


def test_bootstrap_replaces_existing_default_pipelines(
    pgvector_session: Session,
) -> None:
    """A half-set-up user re-running the wizard updates defaults in place."""
    session = pgvector_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    _create_pgvector_index(session, user)
    service = SetupService(session)
    service.bootstrap(user, _bootstrap_request(connection))

    service.bootstrap(
        user,
        _bootstrap_request(
            connection, embedding_model="another/model", collection_name="Second"
        ),
    )

    with Session(session.get_bind()) as fresh:
        defaults = fresh.exec(
            select(models.Pipeline).where(models.Pipeline.is_default)  # type: ignore[arg-type]
        ).all()
    assert len(defaults) == 2
