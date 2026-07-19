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
GOLD = {"d2", "d4", "d6"}  # three gold docs; d6 is never retrieved


def _compute(name: str, k: int, retrieved: list[str], gold: set[str]) -> float:
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
    [(1, 0.0), (3, 1 / 3), (5, 0.4), (10, 0.4)],
)
def test_precision_at_k(k: int, expected: float) -> None:
    """Precision@k divides relevant-in-top-k by min(k, results returned)."""
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
    """nDCG@k is DCG@k over the ideal DCG@k with binary gain."""
    dcg = 1 / math.log2(3) + 1 / math.log2(5)  # gold at ranks 2 and 4
    idcg = 1 / math.log2(2) + 1 / math.log2(3) + 1 / math.log2(4)  # 3 gold ideally
    assert _compute("ndcg", 5, RETRIEVED, GOLD) == pytest.approx(dcg / idcg)


def test_map_at_k() -> None:
    """MAP@k averages precision at each gold hit over min(gold, k)."""
    # P@2 = 1/2 (d2), P@4 = 2/4 (d4); averaged over min(3, 5) = 3 gold docs.
    assert _compute("map", 5, RETRIEVED, GOLD) == pytest.approx((0.5 + 0.5) / 3)


def test_metrics_handle_empty_results() -> None:
    """Every metric is 0.0 when the pipeline returned nothing."""
    for name in ("recall", "precision", "hit", "mrr", "ndcg", "map"):
        assert _compute(name, 5, [], GOLD) == pytest.approx(0.0)


def test_metrics_handle_empty_gold() -> None:
    """An empty gold set yields 0.0 rather than dividing by zero."""
    for name in ("recall", "precision", "hit", "mrr", "ndcg", "map"):
        assert _compute(name, 5, RETRIEVED, set()) == pytest.approx(0.0)


def test_registry_lists_all_v1_metrics() -> None:
    """The registry exposes every v1 retrieval metric with tooltip metadata."""
    names = {metric.name for metric in list_metrics()}
    assert names == {"recall", "precision", "hit", "mrr", "ndcg", "map"}
    for metric in list_metrics():
        assert metric.label and metric.description


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
    assert "recall@10" in result and "ndcg@10" in result
