"""Behavior tests for retrieval metrics with hand-computed expected values.

These pin the exact definitions of every v1 retrieval metric against a fixed
retrieved-vs-gold fixture, plus the edge cases the run engine will actually hit:
`k` larger than the result count, an empty result list, and an empty gold set.
"""

from __future__ import annotations

import math

import pytest

from app.evals.metrics.registry import evaluate_metrics, get_metric, list_metrics

# Ordered, document-level-deduplicated retrieval result: d2 is rank 2, d4 is rank 4.
RETRIEVED = ["d1", "d2", "d3", "d4", "d5"]
GOLD = {"d2": 1, "d4": 1, "d6": 1}  # three gold docs; d6 is never retrieved


def _compute(name: str, k: int, retrieved: list[str], gold: dict[str, int]) -> float:
    return get_metric(name).compute(retrieved, gold, k)


@pytest.mark.parametrize(
    ("k", "expected"),
    [(1, 0.0), (3, 1 / 3), (5, 2 / 3), (10, 2 / 3)],
)
def test_recall_at_k(k: int, expected: float) -> None:
    """Recall@k is gold docs found in the top-k over total gold docs."""
    assert _compute("recall", k, RETRIEVED, GOLD) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("k", "expected"),
    [(1, 0.0), (3, 1 / 3), (5, 0.4), (10, 0.2)],
)
def test_precision_at_k(k: int, expected: float) -> None:
    """Precision@k always divides by k (trec_eval), even with fewer results.

    At k=10 only 5 documents were returned (2 relevant): the score is 2/10, not
    2/5 — a shrinking denominator would inflate precision for sparse returns.
    """
    assert _compute("precision", k, RETRIEVED, GOLD) == pytest.approx(expected)


@pytest.mark.parametrize(("k", "expected"), [(1, 0.0), (3, 1.0), (5, 1.0)])
def test_hit_at_k(k: int, expected: float) -> None:
    """Hit@k is 1.0 when any gold doc is in the top-k, else 0.0."""
    assert _compute("hit", k, RETRIEVED, GOLD) == pytest.approx(expected)


@pytest.mark.parametrize(("k", "expected"), [(1, 0.0), (3, 0.5), (5, 0.5)])
def test_mrr_at_k(k: int, expected: float) -> None:
    """MRR@k is the reciprocal rank of the first gold doc within the top-k."""
    assert _compute("mrr", k, RETRIEVED, GOLD) == pytest.approx(expected)


def test_ndcg_at_k() -> None:
    """nDCG@k is DCG@k over the ideal DCG@k; binary grades give binary gains."""
    dcg = 1 / math.log2(3) + 1 / math.log2(5)  # gold at ranks 2 and 4
    idcg = 1 / math.log2(2) + 1 / math.log2(3) + 1 / math.log2(4)  # 3 gold ideally
    assert _compute("ndcg", 5, RETRIEVED, GOLD) == pytest.approx(dcg / idcg)


def test_ndcg_at_k_uses_relevance_grades_as_gains() -> None:
    """A graded dataset weights highly-relevant docs more, per trec_eval gains."""
    graded = {"d2": 1, "d4": 2, "d6": 3}
    dcg = 1 / math.log2(3) + 2 / math.log2(5)  # d2 at rank 2, d4 at rank 4
    idcg = 3 / math.log2(2) + 2 / math.log2(3) + 1 / math.log2(4)  # grades 3,2,1
    assert _compute("ndcg", 5, RETRIEVED, graded) == pytest.approx(dcg / idcg)


def test_map_at_k() -> None:
    """MAP@k sums precision at each gold hit and divides by total relevant."""
    # P@2 = 1/2 (d2), P@4 = 2/4 (d4); divided by the 3 relevant docs (trec_eval).
    assert _compute("map", 5, RETRIEVED, GOLD) == pytest.approx((0.5 + 0.5) / 3)


def test_map_at_k_divides_by_total_relevant_not_cutoff() -> None:
    """MAP@k normalizes by total relevant R, matching pytrec_eval's map_cut.

    With 4 gold docs but a cutoff of k=2, only the two gold hits inside the
    top-2 contribute precision, and the sum is divided by all 4 relevant docs
    (not min(4, 2) = 2). Dividing by the cutoff would report 1.0 here, hiding
    that half the relevant documents fell outside the top-k.
    """
    retrieved = ["d1", "d2", "d3", "d4"]
    gold = {"d1": 1, "d2": 1, "d5": 1, "d6": 1}  # 4 relevant; d5, d6 never retrieved
    # P@1 = 1/1 (d1), P@2 = 2/2 (d2); divided by 4 relevant docs.
    assert _compute("map", 2, retrieved, gold) == pytest.approx((1.0 + 1.0) / 4)


def test_metrics_handle_empty_results() -> None:
    """Every metric is 0.0 when the pipeline returned nothing."""
    for name in ("recall", "precision", "hit", "mrr", "ndcg", "map"):
        assert _compute(name, 5, [], GOLD) == pytest.approx(0.0)


def test_metrics_handle_empty_gold() -> None:
    """An empty gold set yields 0.0 rather than dividing by zero."""
    for name in ("recall", "precision", "hit", "mrr", "ndcg", "map"):
        assert _compute(name, 5, RETRIEVED, {}) == pytest.approx(0.0)


def test_registry_lists_all_v1_metrics() -> None:
    """The registry exposes every v1 retrieval metric with tooltip metadata."""
    names = {metric.name for metric in list_metrics()}
    assert names == {"recall", "precision", "hit", "mrr", "ndcg", "map"}
    for metric in list_metrics():
        assert metric.label
        assert metric.description


def test_evaluate_metrics_expands_over_k_values() -> None:
    """evaluate_metrics emits one 'name@k' entry per (metric, k) pair."""
    result = evaluate_metrics(
        RETRIEVED, GOLD, k_values=[1, 5], metric_names=["recall", "hit"]
    )
    assert set(result) == {"recall@1", "recall@5", "hit@1", "hit@5"}
    assert result["recall@5"] == pytest.approx(2 / 3)
    assert result["hit@1"] == pytest.approx(0.0)


def test_evaluate_metrics_defaults_to_all_metrics() -> None:
    """An empty metric selection computes every registered metric."""
    result = evaluate_metrics(RETRIEVED, GOLD, k_values=[10], metric_names=[])
    assert "recall@10" in result
    assert "ndcg@10" in result
