"""Result-identity coverage for item-capable pipeline trace summaries."""

from __future__ import annotations

from uuid import uuid4

from app.db.models import ChunkStrategy
from app.pipelines.nodes.chunking import ChunkerConfig, ChunkerNode
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.nodes.fusion import RRFusionConfig, RRFusionNode
from app.pipelines.nodes.indexing import (
    Bm25IndexerConfig,
    Bm25IndexerNode,
    VectorIndexerConfig,
    VectorIndexerNode,
)
from app.pipelines.nodes.io import (
    IngestionOutputConfig,
    IngestionOutputNode,
    RetrievalOutputConfig,
    RetrievalOutputNode,
)
from app.pipelines.nodes.reranking import RerankerConfig, RerankerNode
from app.pipelines.nodes.retrieval import (
    Bm25RetrieverConfig,
    Bm25RetrieverNode,
    VectorRetrieverConfig,
    VectorRetrieverNode,
)
from app.pipelines.payloads import (
    ChunkPayload,
    EmbeddingPayload,
    IndexingPayload,
    ParsedDocumentPayload,
    QueryEmbeddingPayload,
    RetrievalPayload,
    RetrievalRequestPayload,
)
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.retrieval.models import (
    Document,
    DocumentChunk,
    DocumentMetadata,
    QueryRequest,
    RetrievalResponse,
    ScoredChunk,
)
from app.schemas.enums import IndexBackend


def _chunks(count: int) -> list[DocumentChunk]:
    return [
        DocumentChunk(
            document_id="doc",
            chunk_id=f"doc:{index}",
            text=f"chunk {index}",
            order=index,
            metadata=DocumentMetadata(),
            embedding=[index / 10, index / 20],
        )
        for index in range(count)
    ]


def _matches(ids: list[str]) -> list[ScoredChunk]:
    chunks = {chunk.chunk_id: chunk for chunk in _chunks(20)}
    return [
        ScoredChunk(chunk=chunks[chunk_id], score=1.0 - rank / 100)
        for rank, chunk_id in enumerate(ids, start=1)
    ]


def _item_values(values: list[NodeTraceValue]) -> list[object]:
    item_values = [value.value for value in values if value.kind == "items"]
    assert item_values, "node summary did not emit an items value"
    return item_values


def _ranking_value(values: list[NodeTraceValue]) -> object:
    ranking_values = [value.value for value in values if value.kind == "ranking"]
    assert len(ranking_values) == 1, "node summary did not emit one ranking value"
    return ranking_values[0]


def _refs(value: object) -> list[tuple[str, float | None]]:
    kind = getattr(value, "kind", None)
    assert kind in {"chunks", "matches"}
    return [(item.id, item.score) for item in value.items]


def test_linear_ingestion_preserves_every_chunk_id_through_each_node() -> None:
    document = Document(document_id="doc", text="source", metadata=DocumentMetadata())
    chunks = _chunks(12)
    parsed = ParsedDocumentPayload(document=document)
    chunked = ChunkPayload(document=document, chunks=chunks)
    embedded = EmbeddingPayload(document=document, chunks=chunks)
    indexed = IndexingPayload(document=document, chunks=chunks)

    chunker = ChunkerNode(
        ChunkerConfig(strategy=ChunkStrategy.TOKEN, chunk_size=10, chunk_overlap=0)
    )
    embedder = EmbedderNode(EmbedderConfig(connection_id=uuid4(), model_name="embed"))
    vector_indexer = VectorIndexerNode(
        VectorIndexerConfig(
            backend=IndexBackend.PGVECTOR,
            index_name="docs",
            dimension=2,
        )
    )
    bm25_indexer = Bm25IndexerNode(
        Bm25IndexerConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
    )

    summaries = [
        chunker.summarize_io({"document": parsed}, {"chunks": chunked}),
        embedder.summarize_io({"chunks": chunked}, {"embedded": embedded}),
        vector_indexer.summarize_io({"embedded": embedded}, {"indexed": indexed}),
        bm25_indexer.summarize_io({"chunks": chunked}, {"indexed": indexed}),
    ]
    expected = [(f"doc:{index}", None) for index in range(12)]

    assert _refs(_item_values(summaries[0].outputs)[0]) == expected
    for summary in summaries[1:]:
        assert _refs(_item_values(summary.inputs)[0]) == expected
        assert _refs(_item_values(summary.outputs)[0]) == expected


def test_retrievers_keep_full_filtered_match_order_and_scores() -> None:
    filtered_ids = [f"doc:{index}" for index in range(0, 18, 2)]
    matches = _matches(filtered_ids)
    request = QueryRequest(text="query", top_k=20, filter={"category": "kept"})
    dense_input = QueryEmbeddingPayload(request=request, embedding=[0.1, 0.2])
    lexical_input = RetrievalRequestPayload(request=request)
    output = RetrievalPayload(response=RetrievalResponse(matches=matches))
    dense = VectorRetrieverNode(
        VectorRetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs")
    )
    lexical = Bm25RetrieverNode(
        Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
    )

    dense_summary = dense.summarize_io({"query_embedding": dense_input}, {"results": output})
    lexical_summary = lexical.summarize_io({"request": lexical_input}, {"results": output})
    expected = [(match.chunk.chunk_id, match.score) for match in matches]

    assert len(matches) > 5
    assert _refs(_item_values(dense_summary.outputs)[0]) == expected
    assert _refs(_item_values(lexical_summary.outputs)[0]) == expected


def test_rrf_summary_preserves_each_branch_and_complete_fused_order() -> None:
    branch_one = RetrievalPayload(
        response=RetrievalResponse(matches=_matches(["doc:0", "doc:1", "doc:2"]))
    )
    branch_two = RetrievalPayload(
        response=RetrievalResponse(matches=_matches(["doc:1", "doc:3"]))
    )
    fused_matches = _matches(["doc:1", "doc:0", "doc:3", "doc:2"])
    fused = RetrievalPayload(response=RetrievalResponse(matches=fused_matches))
    summary = RRFusionNode(RRFusionConfig()).summarize_io(
        {"results": [branch_one, branch_two]},
        {"results": fused},
    )

    branch_traces = _item_values(summary.inputs)
    assert [_refs(value) for value in branch_traces] == [
        [(match.chunk.chunk_id, match.score) for match in branch_one.response.matches],
        [(match.chunk.chunk_id, match.score) for match in branch_two.response.matches],
    ]
    assert _refs(_item_values(summary.outputs)[0]) == [
        (match.chunk.chunk_id, match.score) for match in fused_matches
    ]


def test_rrf_summary_records_per_source_rank_contributions() -> None:
    branch_one = RetrievalPayload(
        response=RetrievalResponse(matches=_matches(["doc:0", "doc:1", "doc:2"]))
    )
    branch_two = RetrievalPayload(
        response=RetrievalResponse(matches=_matches(["doc:1", "doc:3"]))
    )
    fused = RetrievalPayload(response=RetrievalResponse(matches=_matches(["doc:1", "doc:0"])))

    summary = RRFusionNode(RRFusionConfig(k=60)).summarize_io(
        {"results": [branch_one, branch_two]},
        {"results": fused},
    )

    ranking = _ranking_value(summary.outputs)
    assert ranking.method == "reciprocal_rank_fusion"
    assert ranking.score_label == "RRF score"
    assert ranking.formula == "1 / (60 + rank)"
    focused = next(result for result in ranking.results if result.id == "doc:1")
    assert [(source.source_index, source.rank, source.score, source.contribution) for source in focused.sources] == [
        (0, 2, branch_one.response.matches[1].score, 1 / 62),
        (1, 1, branch_two.response.matches[0].score, 1 / 61),
    ]


def test_reranker_summary_keeps_complete_before_and_after_orders() -> None:
    before_matches = _matches([f"doc:{index}" for index in range(12)])
    after_matches = [
        match.model_copy(update={"score": match.score + 0.25})
        for match in reversed(before_matches)
    ]
    before = RetrievalPayload(response=RetrievalResponse(matches=before_matches))
    after = RetrievalPayload(response=RetrievalResponse(matches=after_matches))

    summary = RerankerNode(
        RerankerConfig(connection_id=uuid4(), model_name="rerank-model")
    ).summarize_io(
        {"results": before},
        {"results": after},
    )

    assert _refs(_item_values(summary.inputs)[0]) == [
        (match.chunk.chunk_id, match.score) for match in before_matches
    ]
    assert _refs(_item_values(summary.outputs)[0]) == [
        (match.chunk.chunk_id, match.score) for match in after_matches
    ]


def test_retrieval_terminal_preserves_complete_match_order_on_both_ports() -> None:
    matches = _matches([f"doc:{index}" for index in range(12)])
    payload = RetrievalPayload(response=RetrievalResponse(matches=matches))

    summary = RetrievalOutputNode(RetrievalOutputConfig()).summarize_io(
        {"results": payload},
        {"result": payload},
    )

    expected = [(match.chunk.chunk_id, match.score) for match in matches]
    assert _refs(_item_values(summary.inputs)[0]) == expected
    assert _refs(_item_values(summary.outputs)[0]) == expected


def test_ingestion_terminal_preserves_each_branch_and_merged_result() -> None:
    document = Document(document_id="doc", text="source", metadata=DocumentMetadata())
    lexical_chunks = [_chunks(3)[index] for index in (0, 2)]
    dense_chunks = _chunks(3)
    lexical = IndexingPayload(document=document, chunks=lexical_chunks)
    dense = IndexingPayload(document=document, chunks=dense_chunks)
    node = IngestionOutputNode(IngestionOutputConfig())
    outputs = {"result": node._merge({"indexed": [lexical, dense]})}

    summary = node.summarize_io({"indexed": [lexical, dense]}, outputs)

    assert [_refs(value) for value in _item_values(summary.inputs)] == [
        [("doc:0", None), ("doc:2", None)],
        [("doc:0", None), ("doc:1", None), ("doc:2", None)],
    ]
    assert _refs(_item_values(summary.outputs)[0]) == [
        ("doc:0", None),
        ("doc:1", None),
        ("doc:2", None),
    ]


def test_non_item_summary_has_no_item_trace() -> None:
    summary = NodeTraceSummary(outputs=[NodeTraceValue(label="Text", value="plain", kind="text")])

    assert [value for value in summary.outputs if value.kind == "items"] == []
