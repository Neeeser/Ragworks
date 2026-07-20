"""The metric registry and the run engine's evaluation entry point.

Adding a metric is one entry in `RETRIEVAL_METRICS` (`retrieval.py`); every
enforcement site — run engine, API catalog, frontend selection — reads metrics
off this registry rather than hardcoding a list.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from app.evals.metrics.base import Metric
from app.evals.metrics.retrieval import RETRIEVAL_METRICS
from app.services.errors import InvalidInputError

_REGISTRY: dict[str, Metric] = {metric.name: metric for metric in RETRIEVAL_METRICS}


def get_metric(name: str) -> Metric:
    """Return a registered metric by name.

    An unknown name is an `InvalidInputError` (→400): run creation validates
    selections through this function, so a typo is rejected before the run
    provisions and ingests anything.
    """
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise InvalidInputError(f"Unknown metric: {name}") from exc


def list_metrics() -> list[Metric]:
    """Return every registered metric in declaration order."""
    return list(_REGISTRY.values())


def evaluate_metrics(
    retrieved: Sequence[str],
    gold: Mapping[str, int],
    *,
    k_values: Sequence[int],
    metric_names: Sequence[str],
) -> dict[str, float]:
    """Compute selected metrics over every cutoff, keyed `"<name>@<k>"`.

    An empty `metric_names` computes every registered metric. `retrieved` is the
    ordered, document-level-deduplicated result list; `gold` maps the query's
    relevant document ids to their positive relevance grades.
    """
    names = list(metric_names) if metric_names else list(_REGISTRY)
    result: dict[str, float] = {}
    for name in names:
        metric = get_metric(name)
        for k in k_values:
            result[f"{name}@{k}"] = metric.compute(retrieved, gold, k)
    return result
