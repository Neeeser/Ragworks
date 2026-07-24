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
from app.services.pipeline_defaults import (
    DEFAULT_COUNT_SLUG,
    DEFAULT_FACET_SLUG,
    DEFAULT_INGEST_SLUG,
    DEFAULT_SEARCH_SLUG,
)
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
        slugs = {pipeline.template_slug for pipeline in pipelines if pipeline.template_slug}
        assert slugs == {DEFAULT_INGEST_SLUG, DEFAULT_SEARCH_SLUG}
        bindings = fresh.exec(
            select(models.CollectionPipelineBinding).where(
                models.CollectionPipelineBinding.collection_id == stored.id
            )
        ).all()
        roles = sorted(models.BindingRole(binding.role).value for binding in bindings)
        assert roles == ["ingest", "tool"]
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
    # all-MiniLM's published limit is 512 tokens; effective limit 496 after the
    # special-token margin. chunk_size 512 > 496 shrinks to 496, preserving the
    # 200/512 overlap ratio (round(496 * 0.39) = 194) — the size no longer
    # over-shrinks by also counting overlap against the budget.
    assert chunkers[0]["config"] == {"chunk_size": 496, "chunk_overlap": 194}


def test_bootstrap_adds_count_and_facet_tools_when_requested(
    pg_search_session: Session,
) -> None:
    """The wizard's opt-in aggregate tools are scaffolded and bound as tools.

    Search stays the primary tool; count and facet bind after it. The aggregate
    tools need a lexical backend, so this runs on the pg_search dev DB.
    """
    session = pg_search_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    _create_pgvector_index(session, user)

    result = SetupService(session).bootstrap(
        user,
        _bootstrap_request(connection, add_count_tool=True, add_facet_tool=True),
    )

    with Session(session.get_bind()) as fresh:
        pipelines = fresh.exec(select(models.Pipeline)).all()
        slugs = {pipeline.template_slug for pipeline in pipelines if pipeline.template_slug}
        assert slugs == {
            DEFAULT_INGEST_SLUG,
            DEFAULT_SEARCH_SLUG,
            DEFAULT_COUNT_SLUG,
            DEFAULT_FACET_SLUG,
        }
        by_slug = {p.template_slug: p.id for p in pipelines if p.template_slug}
        tool_bindings = fresh.exec(
            select(models.CollectionPipelineBinding).where(
                models.CollectionPipelineBinding.collection_id == result.collection.id,
                models.CollectionPipelineBinding.role == models.BindingRole.TOOL,
            )
        ).all()
        assert len(tool_bindings) == 3
        primary = [b for b in tool_bindings if b.is_primary]
        assert len(primary) == 1
        assert primary[0].pipeline_id == by_slug[DEFAULT_SEARCH_SLUG]


def test_bootstrap_skips_aggregate_tools_on_backend_without_lexical_support(
    session: Session,
) -> None:
    """A count/facet flag on a backend that can't serve them is silently skipped.

    Pinecone has neither lexical count nor facet, so the capability gate returns
    no aggregate definitions even when both flags are set — the wizard hides the
    checkboxes on such backends for the same reason.
    """
    connection = add_openrouter_connection(session, _create_user(session))
    payload = _bootstrap_request(
        connection, backend="pinecone", add_count_tool=True, add_facet_tool=True
    )

    definitions = SetupService(session)._aggregate_tool_definitions(payload)

    assert definitions == {}


def test_bootstrap_adds_reranker_to_search_when_requested(
    pgvector_session: Session,
) -> None:
    """A reranker choice splices a reranker into the search tool, widening fetch."""
    session = pgvector_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    reranker = add_connection(session, user, "cohere", {"api_key": "co-key"}, label="Cohere")
    _create_pgvector_index(session, user)

    result = SetupService(session).bootstrap(
        user,
        _bootstrap_request(
            connection,
            reranker={"connection_id": str(reranker.id), "model_name": "rerank-english-v3.0"},
        ),
    )

    assert result.warnings == []
    with Session(session.get_bind()) as fresh:
        search = fresh.exec(
            select(models.Pipeline).where(
                models.Pipeline.template_slug == DEFAULT_SEARCH_SLUG
            )
        ).one()
        versions = fresh.exec(
            select(models.PipelineVersion).where(
                models.PipelineVersion.pipeline_id == search.id
            )
        ).all()
    nodes = [node for version in versions for node in version.definition["nodes"]]
    rerankers = [node for node in nodes if node["type"] == "reranker.model"]
    assert len(rerankers) == 1
    assert rerankers[0]["config"] == {
        "connection_id": str(reranker.id),
        "model_name": "rerank-english-v3.0",
    }
    retrievers = [node for node in nodes if node["type"].startswith("retriever.")]
    assert retrievers
    assert all(
        node["config"]["top_k"] == {"$expr": "result_limit * 3"} for node in retrievers
    )


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
            select(models.Pipeline).where(
                models.Pipeline.template_slug.is_not(None)  # type: ignore[union-attr]
            )
        ).all()
    assert len(defaults) == 2
