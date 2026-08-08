"""Deriving the diff between two eval runs."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.evals.run_comparison import build_comparison
from app.schemas.enums import EvalComparisonCaveatCode, EvalQueryDeltaKind, EvalRunStatus
from app.schemas.evals import (
    EvalRunConfig,
    EvalRunItemRead,
    EvalRunRead,
    FunnelStage,
    FunnelSummary,
)

DATASET = uuid4()
INGEST = uuid4()
SEARCH_A = uuid4()
SEARCH_B = uuid4()
NAMES = {
    DATASET: "SciFact",
    INGEST: "Standard ingest",
    SEARCH_A: "Dense search",
    SEARCH_B: "Hybrid search",
}


def _run(
    *,
    name: str,
    aggregates: dict[str, float],
    dataset_id: UUID = DATASET,
    retrieval_pipeline_id: UUID = SEARCH_A,
    status: EvalRunStatus = EvalRunStatus.COMPLETED,
    degraded_count: int = 0,
    stages: list[FunnelStage] | None = None,
) -> EvalRunRead:
    now = datetime.now(UTC)
    return EvalRunRead(
        id=uuid4(),
        name=name,
        dataset_id=dataset_id,
        ingestion_pipeline_id=INGEST,
        retrieval_pipeline_id=retrieval_pipeline_id,
        status=status,
        config=EvalRunConfig(num_queries=2, distractor_pool_size=0, k_values=[5, 10]),
        progress_done=2,
        progress_total=2,
        degraded_count=degraded_count,
        aggregate_metrics=aggregates,
        funnel=FunnelSummary(stages=stages or []),
        created_at=now,
        updated_at=now,
    )


def _item(
    query_id: str, value: float, *, metric: str = "recall@10", degraded: bool = False
) -> EvalRunItemRead:
    return EvalRunItemRead(
        id=uuid4(),
        query_external_id=query_id,
        query_text=f"question {query_id}",
        result_count=3,
        gold_doc_ids=["d1"],
        retrieved_document_ids=["d1"],
        metrics={metric: value},
        degraded=degraded,
    )


def test_metric_deltas_carry_both_sides_and_the_difference() -> None:
    run_a = _run(name="A", aggregates={"recall@5": 0.4, "recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@5": 0.6, "recall@10": 0.5})

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    by_cutoff = {entry.k: entry for entry in comparison.metrics}
    assert by_cutoff[5].value_a == 0.4
    assert by_cutoff[5].value_b == 0.6
    assert by_cutoff[5].delta is not None
    assert abs((by_cutoff[5].delta or 0.0) - 0.2) < 1e-9
    assert by_cutoff[10].delta == 0.0
    assert comparison.metrics_comparable is True


def test_a_metric_only_one_run_computed_has_no_delta() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5, "ndcg@10": 0.7})

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    ndcg = next(entry for entry in comparison.metrics if entry.metric == "ndcg")
    assert ndcg.value_a is None
    assert ndcg.value_b == 0.7
    assert ndcg.delta is None


def test_queries_are_classified_and_ordered_worst_first() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5})
    items_a = [_item("q1", 1.0), _item("q2", 0.0), _item("q3", 0.5)]
    items_b = [_item("q1", 0.0), _item("q2", 1.0), _item("q3", 0.5)]

    comparison = build_comparison(run_a, items_a, run_b, items_b, names=NAMES)

    assert comparison.headline_metric == "recall"
    assert comparison.headline_k == 10
    assert [(entry.query_external_id, entry.kind) for entry in comparison.queries] == [
        ("q1", EvalQueryDeltaKind.REGRESSED),
        ("q3", EvalQueryDeltaKind.UNCHANGED),
        ("q2", EvalQueryDeltaKind.IMPROVED),
    ]


def test_a_query_only_one_run_evaluated_keeps_its_row() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5})

    comparison = build_comparison(
        run_a, [_item("q1", 1.0)], run_b, [_item("q2", 1.0)], names=NAMES
    )

    kinds = {entry.query_external_id: entry.kind for entry in comparison.queries}
    assert kinds == {"q1": EvalQueryDeltaKind.ONLY_A, "q2": EvalQueryDeltaKind.ONLY_B}
    assert any(
        caveat.code is EvalComparisonCaveatCode.DISJOINT_QUERIES
        for caveat in comparison.caveats
    )


def test_the_headline_metric_is_one_both_runs_computed() -> None:
    """Otherwise every query reads as regressed against a metric A never scored."""
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5, "mrr@10": 0.3})

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    assert comparison.headline_metric == "recall"


def test_no_shared_metric_leaves_the_per_query_table_empty() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"mrr@10": 0.3})

    comparison = build_comparison(
        run_a, [_item("q1", 1.0)], run_b, [_item("q1", 1.0, metric="mrr@10")], names=NAMES
    )

    assert comparison.headline_metric is None
    assert comparison.queries == []
    # An empty table with no caveat would read as "nothing changed".
    assert [caveat.code for caveat in comparison.caveats] == [
        EvalComparisonCaveatCode.NO_SHARED_METRIC
    ]
    assert comparison.metrics_comparable is False


def test_a_query_both_runs_evaluated_but_could_not_score_is_not_only_one_run() -> None:
    """Calling it ONLY_B would claim run A's sample never held the query."""
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5})
    unscored = _item("q1", 0.0)
    unscored.metrics = {}

    comparison = build_comparison(
        run_a, [unscored], run_b, [_item("q1", 1.0)], names=NAMES
    )

    assert [entry.kind for entry in comparison.queries] == [EvalQueryDeltaKind.UNSCORED]
    assert comparison.queries[0].value_a is None
    assert comparison.queries[0].value_b == 1.0
    assert comparison.queries[0].delta is None


def test_different_datasets_invalidate_the_metric_comparison() -> None:
    other = uuid4()
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.9}, dataset_id=other)

    comparison = build_comparison(run_a, [], run_b, [], names={**NAMES, other: "NFCorpus"})

    assert comparison.metrics_comparable is False
    assert [caveat.code for caveat in comparison.caveats] == [
        EvalComparisonCaveatCode.DIFFERENT_DATASETS
    ]
    dataset_difference = next(
        entry for entry in comparison.differences if entry.label == "Dataset"
    )
    assert dataset_difference.invalidates is True
    assert (dataset_difference.value_a, dataset_difference.value_b) == ("SciFact", "NFCorpus")
    # The deltas are still derived — the comparison is labelled, never withheld.
    assert comparison.metrics[0].delta is not None


def test_a_degraded_side_invalidates_the_comparison_and_says_which() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.8}, degraded_count=3)

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    assert comparison.metrics_comparable is False
    caveat = next(
        entry
        for entry in comparison.caveats
        if entry.code is EvalComparisonCaveatCode.DEGRADED_RUN
    )
    assert "Run B scored 3 queries" in caveat.message


def test_an_unfinished_side_is_a_caveat() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5}, status=EvalRunStatus.RUNNING)

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    assert comparison.metrics_comparable is False
    assert any(
        caveat.code is EvalComparisonCaveatCode.UNFINISHED_RUN
        for caveat in comparison.caveats
    )


def test_only_the_fields_that_differ_are_reported() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(
        name="B", aggregates={"recall@10": 0.5}, retrieval_pipeline_id=SEARCH_B
    )

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    assert [entry.label for entry in comparison.differences] == ["Search tool"]
    difference = comparison.differences[0]
    assert (difference.value_a, difference.value_b) == ("Dense search", "Hybrid search")
    assert difference.invalidates is False
    assert comparison.metrics_comparable is True


def test_funnel_stages_align_by_node_id_and_keep_the_unmatched() -> None:
    shared = FunnelStage(
        node_id="ingestion",
        node_type="ingestion",
        label="Indexed",
        gold_retained=8,
        gold_total=10,
        retention=0.8,
    )
    only_a = FunnelStage(
        node_id="rerank-1",
        node_type="llm.rerank",
        label="Rerank",
        gold_retained=5,
        gold_total=10,
        retention=0.5,
    )
    only_b = FunnelStage(
        node_id="fuse-1",
        node_type="fusion.rrf",
        label="Fuse",
        gold_retained=9,
        gold_total=10,
        retention=0.9,
    )
    run_a = _run(name="A", aggregates={"recall@10": 0.5}, stages=[shared, only_a])
    run_b = _run(
        name="B",
        aggregates={"recall@10": 0.5},
        stages=[shared.model_copy(update={"retention": 0.6}), only_b],
    )

    comparison = build_comparison(run_a, [], run_b, [], names=NAMES)

    by_node = {entry.node_id: entry for entry in comparison.funnel}
    assert [entry.node_id for entry in comparison.funnel] == ["ingestion", "rerank-1", "fuse-1"]
    assert by_node["ingestion"].delta is not None
    assert abs(by_node["ingestion"].delta + 0.2) < 1e-9
    assert by_node["rerank-1"].retention_b is None
    assert by_node["fuse-1"].retention_a is None
    assert by_node["fuse-1"].delta is None


def test_per_query_degradation_travels_with_the_row() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5}, degraded_count=1)

    comparison = build_comparison(
        run_a, [_item("q1", 1.0)], run_b, [_item("q1", 0.0, degraded=True)], names=NAMES
    )

    assert comparison.queries[0].degraded_a is False
    assert comparison.queries[0].degraded_b is True


def test_sides_carry_the_names_the_ui_renders() -> None:
    run_a = _run(name="A", aggregates={"recall@10": 0.5})
    run_b = _run(name="B", aggregates={"recall@10": 0.5})

    comparison = build_comparison(run_a, [_item("q1", 1.0)], run_b, [], names=NAMES)

    assert comparison.run_a.dataset_name == "SciFact"
    assert comparison.run_a.retrieval_pipeline_name == "Dense search"
    assert comparison.run_a.scored_count == 1
    assert comparison.run_b.scored_count == 0
