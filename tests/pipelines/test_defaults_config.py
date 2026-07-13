"""Model defaults for pipeline nodes and default pipeline builders read
runtime config (`get_app_config().models`), not the env-only `Settings`.

Every test that overrides a config field writes through `AppSettingRepository`
(the same path the admin PATCH route writes through) and invalidates
`get_app_config`'s process cache -- the autouse `_invalidate_cache` fixture
below resets the cache around every test in this module.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlmodel import Session

from app.db.pg_search_support import set_pg_search_available
from app.db.pgvector_support import set_pgvector_available
from app.db.repositories import AppSettingRepository
from app.pipelines.defaults import (
    bm25_sibling_index_name,
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.nodes.embedding import EmbedderConfig
from app.pipelines.nodes.indexing import VectorIndexerConfig
from app.pipelines.nodes.retrieval import VectorRetrieverConfig
from app.schemas.enums import IndexBackend
from app.services.app_config import invalidate_app_config_cache
from app.services.errors import InvalidInputError
from app.vectorstores.base import VectorStoreCapabilities
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Ensure `get_app_config`'s process-wide cache never leaks across tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _set_override(session: Session, key: str, value: object) -> None:
    AppSettingRepository(session).upsert(key, value, updated_by=None)
    session.commit()
    invalidate_app_config_cache()


def _clear_override(session: Session, key: str) -> None:
    AppSettingRepository(session).delete(key)
    session.commit()
    invalidate_app_config_cache()


def test_embedder_config_default_reads_app_config(session: Session) -> None:
    _set_override(session, "models.default_embedding_model", "override/embedding-model")

    config = EmbedderConfig()

    assert config.model_name == "override/embedding-model"


def test_vector_configs_default_backend_reads_app_config(session: Session) -> None:
    _set_override(session, "indexing.default_backend", "pinecone")

    indexer = VectorIndexerConfig()
    retriever = VectorRetrieverConfig()

    assert indexer.backend is IndexBackend.PINECONE
    assert retriever.backend is IndexBackend.PINECONE


def test_vector_configs_require_an_explicit_index_name(session: Session) -> None:
    """The unified nodes never invent an index: blank stays blank (validation flags it)."""
    assert VectorIndexerConfig(backend=IndexBackend.PGVECTOR).index_name == ""
    assert VectorRetrieverConfig(backend=IndexBackend.PGVECTOR).index_name == ""
    assert VectorIndexerConfig(backend=IndexBackend.PINECONE, index_name="kept").index_name == (
        "kept"
    )


def test_build_default_ingestion_pipeline_uses_overridden_embedding_model(
    session: Session,
) -> None:
    _set_override(session, "models.default_embedding_model", "override/embedding-model")

    definition = build_default_ingestion_pipeline()

    embedder_node = next(node for node in definition.nodes if node.id == "embed-chunks")
    assert embedder_node.config["model_name"] == "override/embedding-model"


def test_default_pipelines_scaffold_pgvector_by_default(session: Session) -> None:
    """Un-overridden installs index into pgvector via the unified vector nodes."""
    ingestion = build_default_ingestion_pipeline()
    retrieval = build_default_retrieval_pipeline()

    indexer_node = next(node for node in ingestion.nodes if node.id == "index-chunks")
    retriever_node = next(node for node in retrieval.nodes if node.id == "vector-retriever")
    assert indexer_node.type == "indexer.vector"
    assert retriever_node.type == "retriever.vector"
    assert indexer_node.config["backend"] == "pgvector"
    assert retriever_node.config["backend"] == "pgvector"
    assert indexer_node.config["index_name"] == "ragworks"


def test_default_pipelines_follow_overridden_backend(session: Session) -> None:
    """Flipping `indexing.default_backend` re-points new scaffolds at Pinecone."""
    _set_override(session, "indexing.default_backend", "pinecone")

    ingestion = build_default_ingestion_pipeline()
    retrieval = build_default_retrieval_pipeline()

    indexer_node = next(node for node in ingestion.nodes if node.id == "index-chunks")
    retriever_node = next(node for node in retrieval.nodes if node.id == "vector-retriever")
    assert indexer_node.config["backend"] == "pinecone"
    assert retriever_node.config["backend"] == "pinecone"


def test_default_retrieval_pipeline_has_no_chat_settings_node(session: Session) -> None:
    """The chat model is a chat-UI concern; scaffolds carry no chat.settings node."""
    definition = build_default_retrieval_pipeline()

    assert all(node.type != "chat.settings" for node in definition.nodes)


def test_build_default_retrieval_pipeline_uses_overridden_models(session: Session) -> None:
    _set_override(session, "models.default_embedding_model", "override/embedding-model")

    definition = build_default_retrieval_pipeline()

    embedder_node = next(node for node in definition.nodes if node.id == "embed-query")
    assert embedder_node.config["model_name"] == "override/embedding-model"


def test_builders_raise_when_no_embedding_model_configured(session: Session) -> None:
    """An unconfigured install must fail loudly, pointing at first-run setup."""
    _clear_override(session, "models.default_embedding_model")

    with pytest.raises(InvalidInputError, match="setup"):
        build_default_ingestion_pipeline()
    with pytest.raises(InvalidInputError, match="setup"):
        build_default_retrieval_pipeline()


def test_builders_accept_explicit_setup_choices(session: Session) -> None:
    """The setup wizard's choices override config entirely, even when unset."""
    _clear_override(session, "models.default_embedding_model")

    ingestion = build_default_ingestion_pipeline(
        embedding_model="wizard/model",
        backend=IndexBackend.PGVECTOR,
        index_name="first-index",
        chunk_size=512,
        chunk_overlap=64,
    )
    retrieval = build_default_retrieval_pipeline(
        embedding_model="wizard/model",
        backend=IndexBackend.PGVECTOR,
        index_name="first-index",
    )

    embedder = next(node for node in ingestion.nodes if node.id == "embed-chunks")
    chunker = next(node for node in ingestion.nodes if node.id == "chunk-document")
    indexer = next(node for node in ingestion.nodes if node.id == "index-chunks")
    query_embedder = next(node for node in retrieval.nodes if node.id == "embed-query")
    retriever = next(node for node in retrieval.nodes if node.id == "vector-retriever")
    assert embedder.config["model_name"] == "wizard/model"
    assert chunker.config == {"chunk_size": 512, "chunk_overlap": 64}
    assert indexer.config["index_name"] == "first-index"
    assert query_embedder.config["model_name"] == "wizard/model"
    assert retriever.config["index_name"] == "first-index"


def test_default_scaffold_omits_bm25_when_pgvector_extension_unavailable(
    session: Session,
) -> None:
    """Lexical availability requires pgvector itself, not just pg_search."""
    set_pgvector_available(False)
    set_pg_search_available(True)
    try:
        definition = build_default_ingestion_pipeline(
            embedding_model="test/embed", backend=IndexBackend.PGVECTOR
        )
    finally:
        set_pgvector_available(True)
    assert "indexer.bm25" not in {node.type for node in definition.nodes}


def test_bm25_sibling_name_truncates_to_backend_capability(monkeypatch) -> None:
    """The sibling-name cap is read off the backend's capabilities, not hardcoded."""
    tight = VectorStoreCapabilities(
        max_dimension=2000,
        supported_metrics=("cosine",),
        supported_vector_types=("dense", "sparse"),
        requires_api_key=False,
        index_name_max_length=20,
    )
    monkeypatch.setitem(CAPABILITIES_BY_BACKEND, IndexBackend.PGVECTOR, tight)

    sibling = bm25_sibling_index_name("a" * 30, IndexBackend.PGVECTOR)

    assert len(sibling) <= 20
    assert sibling.endswith("-bm25")


def test_default_scaffolds_carry_no_positions(session: Session) -> None:
    """Scaffolds defer placement to the frontend's shared auto-layout.

    A hand-placed coordinate here would bypass `needsAutoLayout` in the
    editor and freeze the scaffold in a layout the algorithm never chose —
    the drift this rule exists to prevent.
    """
    _set_override(session, "models.default_embedding_model", "test/embed")

    for definition in (build_default_ingestion_pipeline(), build_default_retrieval_pipeline()):
        assert all(node.position is None for node in definition.nodes)
