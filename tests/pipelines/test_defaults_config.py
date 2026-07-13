"""Default pipeline builders: explicit embedding choices and config-driven backend.

Global default models are gone — the builders require an explicit
`(embedding_connection_id, embedding_model)` — so what remains config-driven
is the vector backend (`indexing.default_backend`), plus the scaffold layout
rules. Config-override tests write through `AppSettingRepository` (the admin
PATCH path) and invalidate the process cache around every test.
"""

from __future__ import annotations

from collections.abc import Iterator
from uuid import uuid4

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
from app.vectorstores.base import VectorStoreCapabilities
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND

EMBED_CONNECTION_ID = uuid4()


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


def _build_ingestion(**overrides: object):
    kwargs: dict[str, object] = {
        "embedding_connection_id": EMBED_CONNECTION_ID,
        "embedding_model": "test/embed",
    }
    kwargs.update(overrides)
    return build_default_ingestion_pipeline(**kwargs)  # type: ignore[arg-type]


def _build_retrieval(**overrides: object):
    kwargs: dict[str, object] = {
        "embedding_connection_id": EMBED_CONNECTION_ID,
        "embedding_model": "test/embed",
    }
    kwargs.update(overrides)
    return build_default_retrieval_pipeline(**kwargs)  # type: ignore[arg-type]


def test_embedder_config_has_no_implicit_defaults() -> None:
    """An empty embedder config validates (editor drafts) but names nothing."""
    config = EmbedderConfig()
    assert config.connection_id is None
    assert config.model_name == ""


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


def test_default_pipelines_scaffold_pgvector_by_default(session: Session) -> None:
    """Un-overridden installs index into pgvector via the unified vector nodes."""
    ingestion = _build_ingestion()
    retrieval = _build_retrieval()

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

    ingestion = _build_ingestion()
    retrieval = _build_retrieval()

    indexer_node = next(node for node in ingestion.nodes if node.id == "index-chunks")
    retriever_node = next(node for node in retrieval.nodes if node.id == "vector-retriever")
    assert indexer_node.config["backend"] == "pinecone"
    assert retriever_node.config["backend"] == "pinecone"


def test_default_retrieval_pipeline_has_no_chat_settings_node(session: Session) -> None:
    """The chat model is a chat-UI concern; scaffolds carry no chat.settings node."""
    definition = _build_retrieval()

    assert all(node.type != "chat.settings" for node in definition.nodes)


def test_builders_stamp_the_explicit_embedding_choice(session: Session) -> None:
    """The wizard's confirmed choices land verbatim on both embedder nodes."""
    ingestion = _build_ingestion(
        embedding_model="wizard/model",
        backend=IndexBackend.PGVECTOR,
        index_name="first-index",
        chunk_size=512,
        chunk_overlap=64,
    )
    retrieval = _build_retrieval(
        embedding_model="wizard/model",
        backend=IndexBackend.PGVECTOR,
        index_name="first-index",
    )

    embedder = next(node for node in ingestion.nodes if node.id == "embed-chunks")
    chunker = next(node for node in ingestion.nodes if node.id == "chunk-document")
    indexer = next(node for node in ingestion.nodes if node.id == "index-chunks")
    query_embedder = next(node for node in retrieval.nodes if node.id == "embed-query")
    retriever = next(node for node in retrieval.nodes if node.id == "vector-retriever")
    assert embedder.type == "embedder.text"
    assert embedder.config["model_name"] == "wizard/model"
    assert embedder.config["connection_id"] == str(EMBED_CONNECTION_ID)
    assert chunker.config == {"chunk_size": 512, "chunk_overlap": 64}
    assert indexer.config["index_name"] == "first-index"
    assert query_embedder.config["model_name"] == "wizard/model"
    assert query_embedder.config["connection_id"] == str(EMBED_CONNECTION_ID)
    assert retriever.config["index_name"] == "first-index"


def test_default_scaffold_omits_bm25_when_pgvector_extension_unavailable(
    session: Session,
) -> None:
    """Lexical availability requires pgvector itself, not just pg_search."""
    set_pgvector_available(False)
    set_pg_search_available(True)
    try:
        definition = _build_ingestion(backend=IndexBackend.PGVECTOR)
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


def test_bm25_branch_nodes_sit_in_the_column_after_their_source(session: Session) -> None:
    """The BM25 branch shares a column with the next main-row node.

    A half-column offset makes the branch edge run horizontally at the
    source's row — visually hidden behind the intervening card (embedder /
    query embedder). Placing the branch directly below the next column keeps
    the descent inside the first gap.
    """
    ingestion = _build_ingestion()
    positions = {node.id: node.position for node in ingestion.nodes}
    assert positions["index-bm25"].x == positions["embed-chunks"].x

    retrieval = _build_retrieval()
    positions = {node.id: node.position for node in retrieval.nodes}
    assert positions["bm25-retriever"].x == positions["embed-query"].x


def test_hybrid_ingestion_output_is_centered_between_index_branches(session: Session) -> None:
    """Both index edges must approach the shared output without crossing a node card."""
    definition = _build_ingestion()
    positions = {node.id: node.position for node in definition.nodes}

    assert positions["ingest-output"].y == (
        positions["index-chunks"].y + positions["index-bm25"].y
    ) / 2
