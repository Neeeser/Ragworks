"""Behavior tests for the trace-attribution recall funnel and findings.

The funnel must attribute gold-document loss to the specific pipeline node that
caused it (node-addressed, never an abstract stage name), so a hybrid pipeline
with two retrievers produces two distinct funnel entries and two distinct
findings. Ingestion loss and reranker demotion are called out explicitly.
"""

from __future__ import annotations

from app.evals.attribution.funnel import QueryFunnelInput, QueryNodeTrace, build_funnel

GOLD = {"A", "B", "C", "D"}


def _node(node_id: str, node_type: str, label: str, docs: list[str]) -> QueryNodeTrace:
    return QueryNodeTrace(node_id=node_id, node_type=node_type, label=label, document_ids=docs)


def test_linear_funnel_stages_and_retention() -> None:
    """Stages run ingestion → nodes in order, with exact per-node retention."""
    query = QueryFunnelInput(
        gold_doc_ids=GOLD,
        indexed_gold_doc_ids=GOLD,
        nodes=[
            _node("R1", "retriever.pgvector", "Dense", ["A", "B", "C"]),
            _node("RK", "reranker.cohere", "Reranker", ["A", "C"]),
            _node("OUT", "output", "Output", ["A", "C"]),
        ],
    )
    funnel = build_funnel([query], edges=[("R1", "RK"), ("RK", "OUT")])
    stages = {stage.node_id: stage for stage in funnel.stages}
    assert [s.node_id for s in funnel.stages] == ["ingestion", "R1", "RK", "OUT"]
    assert stages["ingestion"].retention == 1.0
    assert stages["R1"].retention == 0.75
    assert stages["RK"].retention == 0.5


def test_reranker_demotion_is_a_node_addressed_finding() -> None:
    """A reranker that drops gold its input found is flagged by node, as demotion."""
    query = QueryFunnelInput(
        gold_doc_ids=GOLD,
        indexed_gold_doc_ids=GOLD,
        nodes=[
            _node("R1", "retriever.pgvector", "Dense", ["A", "B", "C"]),
            _node("RK", "reranker.cohere", "Reranker", ["A", "C"]),
            _node("OUT", "output", "Output", ["A", "C"]),
        ],
    )
    funnel = build_funnel([query], edges=[("R1", "RK"), ("RK", "OUT")])
    rerank_findings = [f for f in funnel.findings if f.node_id == "RK"]
    assert len(rerank_findings) == 1
    finding = rerank_findings[0]
    assert finding.category == "reranking"
    assert "demoted" in finding.message.lower()
    assert "Reranker" in finding.message


def test_ingestion_coverage_loss_is_flagged() -> None:
    """Gold docs that never produced chunks are an ingestion-stage finding."""
    query = QueryFunnelInput(
        gold_doc_ids=GOLD,
        indexed_gold_doc_ids={"A", "B", "C"},  # D failed to index
        nodes=[_node("R1", "retriever.pgvector", "Dense", ["A", "B", "C"])],
    )
    funnel = build_funnel([query], edges=[])
    ingestion_stage = next(s for s in funnel.stages if s.node_id == "ingestion")
    assert ingestion_stage.retention == 0.75
    ingestion_findings = [f for f in funnel.findings if f.node_id == "ingestion"]
    assert len(ingestion_findings) == 1
    assert ingestion_findings[0].category == "ingestion"


def test_hybrid_retrievers_are_addressed_individually() -> None:
    """Two retrievers at different indexes get two distinct stages and findings."""
    query = QueryFunnelInput(
        gold_doc_ids=GOLD,
        indexed_gold_doc_ids=GOLD,
        nodes=[
            _node("R1", "retriever.pgvector", "Dense", ["A", "B"]),
            _node("R2", "retriever.bm25", "BM25", ["C"]),
            _node("FUSE", "fusion.rrf", "Fusion", ["A", "B", "C"]),
            _node("OUT", "output", "Output", ["A", "B", "C"]),
        ],
    )
    funnel = build_funnel(
        [query], edges=[("R1", "FUSE"), ("R2", "FUSE"), ("FUSE", "OUT")]
    )
    stage_ids = {s.node_id for s in funnel.stages}
    assert {"R1", "R2", "FUSE"} <= stage_ids
    retriever_findings = {f.node_id for f in funnel.findings if f.category == "retrieval"}
    assert {"R1", "R2"} <= retriever_findings
    # Fusion recovered gold, so it is not flagged as a loss.
    assert not any(f.node_id == "FUSE" for f in funnel.findings)


def test_findings_aggregate_across_queries() -> None:
    """Retention sums gold across every evaluated query."""
    q1 = QueryFunnelInput(
        gold_doc_ids={"A", "B"},
        indexed_gold_doc_ids={"A", "B"},
        nodes=[_node("R1", "retriever.pgvector", "Dense", ["A"])],
    )
    q2 = QueryFunnelInput(
        gold_doc_ids={"C", "D"},
        indexed_gold_doc_ids={"C", "D"},
        nodes=[_node("R1", "retriever.pgvector", "Dense", ["C", "D"])],
    )
    funnel = build_funnel([q1, q2], edges=[])
    r1 = next(s for s in funnel.stages if s.node_id == "R1")
    # q1 found 1/2, q2 found 2/2 → 3 of 4 gold overall.
    assert r1.gold_retained == 3
    assert r1.gold_total == 4
    assert r1.retention == 0.75
