"""The read-only catalogs the eval UI renders: benchmarks and metrics.

Both are pure registry-to-wire projections with no session and no state, so
they sit beside `EvalService` rather than on it.
"""

from __future__ import annotations

from app.evals.datasets.builtin import list_builtin
from app.evals.metrics.registry import list_metrics
from app.schemas.enums import EvalModality
from app.schemas.evals import EvalMetricInfo
from app.schemas.evals_corpus import BuiltinDatasetInfo


def builtin_catalog() -> list[BuiltinDatasetInfo]:
    """Return the curated benchmark registry for the import picker."""
    return [
        BuiltinDatasetInfo(
            key=entry.key,
            name=entry.name,
            description=entry.description,
            domain=entry.domain,
            measures=entry.measures,
            num_queries=entry.num_queries,
            num_corpus_docs=entry.num_corpus_docs,
            modalities=[EvalModality(value) for value in entry.modalities],
            license_name=entry.license_name,
            approx_download_mb=entry.approx_download_mb,
        )
        for entry in list_builtin()
    ]


def metric_catalog() -> list[EvalMetricInfo]:
    """Return every registered metric with its tooltip description."""
    return [
        EvalMetricInfo(
            name=metric.name,
            label=metric.label,
            description=metric.description,
            is_rank_aware=metric.is_rank_aware,
        )
        for metric in list_metrics()
    ]
