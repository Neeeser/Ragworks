"""BM25 indexer/retriever and fusion node behavior."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.fusion import RRFusionConfig, RRFusionNode
from app.pipelines.nodes.indexing import Bm25IndexerConfig, Bm25IndexerNode
from app.pipelines.nodes.io import IngestionOutputConfig, IngestionOutputNode
from app.pipelines.nodes.retrieval import (
    Bm25RetrieverConfig,
    Bm25RetrieverNode,
    VectorRetrieverConfig,
    VectorRetrieverNode,
)
from app.pipelines.nodes.validators import lexical_support_issue
from app.pipelines.payloads import (
    ChunkPayload,
    IndexingPayload,
    QueryEmbeddingPayload,
    RetrievalPayload,
    RetrievalRequestPayload,
)
from app.pipelines.registry import default_registry
from app.pipelines.tracing.summaries import TokenUsage
from app.retrieval.models import (
    Document,
    DocumentChunk,
    DocumentMetadata,
    QueryRequest,
    RetrievalResponse,
    ScoredChunk,
)
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError, NotFoundError
from app.utils.file_storage import FileStorage
from app.vectorstores.base import VectorStoreCapabilities
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
)


def _context(
    session: Session,
    store: StubVectorStore,
    *,
    query: str | None = None,
    top_k: int | None = None,
) -> PipelineRunContext:
    return PipelineRunContext(
        session=session,
        user=models.User(id=uuid4(), email="bm25@t.local", hashed_password="hashed"),
        collection=models.Collection(
            id=uuid4(), user_id=uuid4(), name="C", description="", extra_metadata={}
        ),
        document=None,
        query=query,
        top_k=top_k,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(),
        settings=get_settings(),
    )


def _text_chunks(count: int) -> list[DocumentChunk]:
    return [
        DocumentChunk(
            document_id="doc",
            chunk_id=f"doc:{i}",
            text=f"chunk {i}",
            order=i,
            metadata=DocumentMetadata(),
        )
        for i in range(count)
    ]


def _scored(chunk_id: str, score: float = 1.0) -> ScoredChunk:
    return ScoredChunk(
        chunk=DocumentChunk(
            document_id=chunk_id.split(":")[0],
            chunk_id=chunk_id,
            text=f"text {chunk_id}",
            order=0,
            metadata=DocumentMetadata(),
        ),
        score=score,
    )


def _retrieval_payload(*chunk_ids: str, usage: TokenUsage | None = None) -> RetrievalPayload:
    return RetrievalPayload(
        response=RetrievalResponse(matches=[_scored(chunk_id) for chunk_id in chunk_ids]),
        usage=usage or TokenUsage(),
    )


def test_bm25_indexer_ensures_sparse_index_and_upserts_text(session: Session) -> None:
    store = StubVectorStore()
    context = _context(session, store)
    node = Bm25IndexerNode(
        Bm25IndexerConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
    )
    payload = ChunkPayload(
        document=Document(document_id="doc", text="x", metadata=DocumentMetadata()),
        chunks=_text_chunks(3),
    )

    outputs = node.run({"chunks": payload}, context)

    assert len(store.ensure_calls) == 1
    assert store.ensure_calls[0].vector_type == "sparse"
    assert store.ensure_calls[0].name == "docs-bm25"
    assert store.ensure_calls[0].dimension is None
    assert [len(call["chunks"]) for call in store.upsert_lexical_calls] == [3]
    assert store.upsert_calls == []  # never touches the dense plane
    result = IndexingPayload.model_validate(outputs["indexed"])
    assert len(result.chunks) == 3


def test_bm25_indexer_batches_at_lexical_limit(session: Session) -> None:
    class _SmallBatchStore(StubVectorStore):
        capabilities = VectorStoreCapabilities(
            max_dimension=2000,
            supported_metrics=("cosine",),
            supported_vector_types=("dense", "sparse"),
            max_lexical_upsert_batch=96,
            requires_api_key=False,
        )

    store = _SmallBatchStore()
    context = _context(session, store)
    node = Bm25IndexerNode(Bm25IndexerConfig(index_name="docs-bm25"))
    payload = ChunkPayload(
        document=Document(document_id="doc", text="x", metadata=DocumentMetadata()),
        chunks=_text_chunks(200),
    )

    node.run({"chunks": payload}, context)

    assert [len(call["chunks"]) for call in store.upsert_lexical_calls] == [96, 96, 8]


def test_bm25_nodes_flag_missing_index_name() -> None:
    node = PipelineNodeDefinition(id="bm25-1", type="indexer.bm25", name="BM25", config={})
    definition = PipelineDefinition(nodes=[node], edges=[])
    issues = Bm25IndexerNode.validation_issues_for_node(node, definition, default_registry())
    assert any("must specify an index" in issue.message for issue in issues)

    retriever = PipelineNodeDefinition(
        id="bm25-2", type="retriever.bm25", name="BM25 R", config={}
    )
    issues = Bm25RetrieverNode.validation_issues_for_node(
        retriever, PipelineDefinition(nodes=[retriever], edges=[]), default_registry()
    )
    assert any("must specify an index" in issue.message for issue in issues)


def test_retriever_nodes_flag_missing_top_k() -> None:
    """Fetch depth is required config — no silent fallback to the request's depth."""
    retriever = PipelineNodeDefinition(
        id="r1", type="retriever.vector", name="R", config={"index_name": "docs"}
    )
    issues = VectorRetrieverNode.validation_issues_for_node(
        retriever, PipelineDefinition(nodes=[retriever], edges=[]), default_registry()
    )
    assert any("no top_k configured" in issue.message for issue in issues)

    bm25 = PipelineNodeDefinition(
        id="r2", type="retriever.bm25", name="B", config={"index_name": "docs-bm25"}
    )
    issues = Bm25RetrieverNode.validation_issues_for_node(
        bm25, PipelineDefinition(nodes=[bm25], edges=[]), default_registry()
    )
    assert any("no top_k configured" in issue.message for issue in issues)


def test_retriever_run_refuses_unset_top_k(session: Session) -> None:
    """An unset depth is an honest error at run time, never a hidden fallback."""
    store = StubVectorStore()
    context = _context(session, store)
    dense = VectorRetrieverNode(
        VectorRetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs")
    )
    payload = QueryEmbeddingPayload(
        request=QueryRequest(text="q", top_k=4), embedding=[0.1, 0.2]
    )
    with pytest.raises(InvalidInputError, match="top_k"):
        dense.run({"query_embedding": payload}, context)
    assert store.query_calls == []

    sparse = Bm25RetrieverNode(
        Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
    )
    request_payload = RetrievalRequestPayload(request=QueryRequest(text="q", top_k=4))
    with pytest.raises(InvalidInputError, match="top_k"):
        sparse.run({"request": request_payload}, context)
    assert store.lexical_query_calls == []


def test_lexical_support_issue_flags_dense_only_backend() -> None:
    dense_only = VectorStoreCapabilities(
        max_dimension=1024,
        supported_metrics=("cosine",),
        requires_api_key=False,
    )
    issue = lexical_support_issue(dense_only, "densebackend", "bm25-1")
    assert issue is not None
    assert "does not support" in issue.message


def test_bm25_retriever_queries_lexically_with_raw_text(session: Session) -> None:
    store = StubVectorStore(lexical_matches=[_scored("doc:1", 2.5)])
    context = _context(session, store)
    node = Bm25RetrieverNode(
        Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25", top_k=4)
    )
    # The request's depth is never consulted — the config is the only source.
    payload = RetrievalRequestPayload(request=QueryRequest(text="error E1042", top_k=9))

    outputs = node.run({"request": payload}, context)

    assert store.lexical_query_calls == [
        {
            "index": "docs-bm25",
            "namespace": f"col-{context.collection.id}",
            "text": "error E1042",
            "top_k": 4,
            "filter": None,
        }
    ]
    assert store.query_calls == []  # never touches the dense plane
    result = RetrievalPayload.model_validate(outputs["results"])
    assert [match.chunk.chunk_id for match in result.response.matches] == ["doc:1"]


def test_bm25_retriever_degrades_to_empty_when_index_is_wrong_type(session: Session) -> None:
    """A BM25 index name resolving to a dense index degrades the branch, not the query."""
    store = StubVectorStore()
    store.lexical_query_error = InvalidInputError(
        "pgvector index 'docs' is a dense index; this operation requires a sparse index."
    )
    context = _context(session, store)
    node = Bm25RetrieverNode(
        Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs", top_k=4)
    )
    payload = RetrievalRequestPayload(request=QueryRequest(text="q", top_k=4))

    outputs = node.run({"request": payload}, context)

    result = RetrievalPayload.model_validate(outputs["results"])
    assert result.response.matches == []


def test_vector_retriever_degrades_to_empty_when_index_not_created_yet(
    session: Session,
) -> None:
    """Querying before first ingest returns no matches instead of a 404."""
    store = StubVectorStore()
    store.query_error = NotFoundError("pgvector index 'docs' not found.")
    context = _context(session, store)
    node = VectorRetrieverNode(
        VectorRetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs", top_k=4)
    )
    payload = QueryEmbeddingPayload(
        request=QueryRequest(text="q", top_k=4), embedding=[0.1, 0.2]
    )

    outputs = node.run({"query_embedding": payload}, context)

    result = RetrievalPayload.model_validate(outputs["results"])
    assert result.response.matches == []


def test_rrf_fusion_accumulates_rank_scores_across_branches(session: Session) -> None:
    """A chunk found by several branches outranks single-branch chunks."""
    node = RRFusionNode(RRFusionConfig())
    context = _context(session, StubVectorStore(), query="q", top_k=10)
    branches = [
        _retrieval_payload("a", "b", "c"),
        _retrieval_payload("b", "d"),
    ]

    outputs = node.run({"results": branches}, context)

    result = RetrievalPayload.model_validate(outputs["results"])
    ordered = [match.chunk.chunk_id for match in result.response.matches]
    assert ordered == ["b", "a", "d", "c"]
    scores = [match.score for match in result.response.matches]
    assert scores == sorted(scores, reverse=True)
    # b appears at rank 2 and rank 1: 1/62 + 1/61
    assert result.response.matches[0].score == 1 / 62 + 1 / 61


def test_rrf_fusion_never_cuts(session: Session) -> None:
    """Fusion emits every fused candidate; cutting is the Top-N node's job."""
    node = RRFusionNode(RRFusionConfig())
    context = _context(session, StubVectorStore(), query="q", top_k=2)
    branches = [_retrieval_payload("a", "b", "c"), _retrieval_payload("d")]

    outputs = node.run({"results": branches}, context)

    result = RetrievalPayload.model_validate(outputs["results"])
    assert len(result.response.matches) == 4


def test_rrf_fusion_sums_usage_across_branches(session: Session) -> None:
    node = RRFusionNode(RRFusionConfig())
    context = _context(session, StubVectorStore(), query="q", top_k=5)
    branches = [
        _retrieval_payload("a", usage=TokenUsage(prompt_tokens=7, total_tokens=7)),
        _retrieval_payload("b"),  # lexical branch: no usage
    ]

    outputs = node.run({"results": branches}, context)

    result = RetrievalPayload.model_validate(outputs["results"])
    assert result.usage.prompt_tokens == 7
    assert result.usage.total_tokens == 7


def test_ingestion_output_merges_branches_preferring_embedded_chunks(
    session: Session,
) -> None:
    document = Document(document_id="doc", text="x", metadata=DocumentMetadata())
    embedded_chunks = [
        DocumentChunk(
            document_id="doc",
            chunk_id="doc:0",
            text="chunk",
            order=0,
            metadata=DocumentMetadata(),
            embedding=[0.1, 0.2],
        )
    ]
    dense = IndexingPayload(
        document=document,
        chunks=embedded_chunks,
        usage=TokenUsage(prompt_tokens=11, total_tokens=11),
    )
    lexical = IndexingPayload(document=document, chunks=_text_chunks(1))
    node = IngestionOutputNode(IngestionOutputConfig())
    context = _context(session, StubVectorStore())

    outputs = node.run({"indexed": [lexical, dense]}, context)

    result = IndexingPayload.model_validate(outputs["result"])
    assert result.chunks[0].embedding == [0.1, 0.2]
    assert result.usage.prompt_tokens == 11


def test_rrf_fusion_config_rejects_removed_top_k_silently(session: Session) -> None:
    """A legacy `top_k` config key is ignored (extra keys don't parse), never a cut."""
    node = RRFusionNode(RRFusionConfig.model_validate({"k": 60, "top_k": 1}))
    context = _context(session, StubVectorStore(), query="q", top_k=1)
    branches = [_retrieval_payload("a", "b"), _retrieval_payload("c")]

    outputs = node.run({"results": branches}, context)

    result = RetrievalPayload.model_validate(outputs["results"])
    assert len(result.response.matches) == 3


def test_ingestion_output_merge_is_not_fooled_by_unembedded_first_chunk(
    session: Session,
) -> None:
    """Branch selection counts embedded chunks; it never keys off chunk[0] alone."""
    document = Document(document_id="doc", text="x", metadata=DocumentMetadata())
    dense_chunks = _text_chunks(2)
    dense_chunks[1] = dense_chunks[1].model_copy(update={"embedding": [0.1, 0.2]})
    dense = IndexingPayload(document=document, chunks=dense_chunks)
    lexical = IndexingPayload(document=document, chunks=_text_chunks(2))
    node = IngestionOutputNode(IngestionOutputConfig())
    context = _context(session, StubVectorStore())

    outputs = node.run({"indexed": [lexical, dense]}, context)

    result = IndexingPayload.model_validate(outputs["result"])
    assert result.chunks[1].embedding == [0.1, 0.2]
