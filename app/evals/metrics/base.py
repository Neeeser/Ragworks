"""The metric interface shared by every retrieval metric.

A metric is stateless: metadata (name, tooltip text, rank-awareness) plus a pure
`compute(retrieved, gold, k)` function. Retrieved ids are document-level and
already deduplicated in rank order; gold is the set of relevant document ids for
the query. Every metric is defined as an @k function so the registry can expand
it over a run's configured cutoffs.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

MetricFn = Callable[[Sequence[str], set[str], int], float]


@dataclass(frozen=True)
class Metric:
    """A registered retrieval metric plus the metadata the UI renders."""

    name: str
    label: str
    description: str
    is_rank_aware: bool
    compute: MetricFn
