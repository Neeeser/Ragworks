"""Backend-specific indexer/retriever node behavior: capability validation,
catalog presence, upsert batching, and settings backend resolution."""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.indexing import PgvectorIndexerConfig
from app.pipelines.nodes.indexing_legacy import IndexerNode, PgvectorIndexerNode
from app.pipelines.payloads import EmbeddingPayload
from app.pipelines.registry import default_registry
from app.pipelines.settings import resolve_ingestion_settings, resolve_retrieval_settings
from app.retrieval.models import Document, DocumentChunk, DocumentMetadata
from app.schemas.enums import IndexBackend
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
)

EMBED_CONNECTION_ID = uuid4()


def _collection() -> models.Collection:
    return models.Collection(
        id=uuid4(),
        user_id=uuid4(),
        name="Backend Collection",
        description="",
        extra_metadata={},
    )


def _node(node_type: str, config: dict[str, object]) -> PipelineNodeDefinition:
    return PipelineNodeDefinition(id="indexer-1", type=node_type, name="Indexer", config=config)


def _definition(node: PipelineNodeDefinition) -> PipelineDefinition:
    return PipelineDefinition(nodes=[node], edges=[])


def test_pgvector_indexer_rejects_dimension_over_backend_max() -> None:
    node = _node("indexer.pgvector", {"index_name": "docs", "dimension": 4097})
    issues = PgvectorIndexerNode.validation_issues_for_node(
        node, _definition(node), default_registry()
    )
    assert any("4096" in issue.message and issue.severity == "error" for issue in issues)


def test_pgvector_indexer_rejects_unsupported_metric() -> None:
    node = _node("indexer.pgvector", {"index_name": "docs", "metric": "euclidean"})
    issues = PgvectorIndexerNode.validation_issues_for_node(
        node, _definition(node), default_registry()
    )
    assert any("euclidean" in issue.message and issue.severity == "error" for issue in issues)


def test_pinecone_indexer_accepts_high_dimension_and_euclidean() -> None:
    node = _node(
        "indexer.pinecone",
        {"index_name": "docs", "dimension": 3072, "metric": "euclidean"},
    )
    issues = IndexerNode.validation_issues_for_node(node, _definition(node), default_registry())
    assert issues == []


def test_registry_catalog_includes_pgvector_nodes() -> None:
    types = default_registry().node_types()
    assert {"indexer.pgvector", "retriever.pgvector", "indexer.pinecone", "retriever.pinecone"} <= types


def test_indexer_splits_upserts_at_backend_batch_limit(session: Session) -> None:
    store = StubVectorStore()
    context = PipelineRunContext(
        session=session,
        user=models.User(id=uuid4(), email="b@t.local", hashed_password="hashed"),
        collection=_collection(),
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(),
        settings=get_settings(),
    )
    chunks = [
        DocumentChunk(
            document_id="doc",
            chunk_id=f"doc:{i}",
            text="x",
            order=i,
            metadata=DocumentMetadata(),
            embedding=[0.1, 0.2],
        )
        for i in range(2500)
    ]
    payload = EmbeddingPayload(
        document=Document(document_id="doc", text="x", metadata=DocumentMetadata()),
        chunks=chunks,
        usage={},
    )
    node = PgvectorIndexerNode(PgvectorIndexerConfig(index_name="docs", dimension=2))

    node.run({"embedded": payload}, context)

    assert [len(call["chunks"]) for call in store.upsert_calls] == [1000, 1000, 500]


def test_resolved_settings_report_backend() -> None:
    ingestion = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
    )
    collection = _collection()
    registry = default_registry()

    settings = resolve_ingestion_settings(ingestion, collection, registry)
    assert settings.backend is IndexBackend.PGVECTOR

    pinecone_node = _node("indexer.pinecone", {"index_name": "pine-idx"})
    pinecone_settings = resolve_ingestion_settings(
        _definition(pinecone_node), collection, registry
    )
    assert pinecone_settings.backend is IndexBackend.PINECONE
    assert pinecone_settings.index_name == "pine-idx"

    retriever_node = PipelineNodeDefinition(
        id="retriever-1",
        type="retriever.pgvector",
        name="Retriever",
        config={"index_name": "docs"},
    )
    retrieval_settings = resolve_retrieval_settings(
        _definition(retriever_node), collection, registry
    )
    assert retrieval_settings.backend is IndexBackend.PGVECTOR
    assert retrieval_settings.index_name == "docs"
