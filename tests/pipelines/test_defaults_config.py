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

from app.db.repositories import AppSettingRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.nodes.embedding import EmbedderConfig
from app.pipelines.nodes.indexing import VectorIndexerConfig
from app.pipelines.nodes.retrieval import VectorRetrieverConfig
from app.schemas.enums import IndexBackend
from app.services.app_config import invalidate_app_config_cache


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
