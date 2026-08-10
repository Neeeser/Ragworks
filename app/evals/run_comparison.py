"""Diff two eval runs: metric deltas, per-query movement, gold retention.

The eval loop is change one thing, re-run, compare — and the compare half is
only meaningful when the two runs measured the same thing. So every derivation
here ships beside the reason it might not count: a run on another dataset is a
different measurement, and a run holding a degraded node scored a pipeline that
only partly executed. Both are reported and labelled rather than refused, because
the numbers are still the record of what happened.

Derivation is pure over the wire read models; `compare_runs` is the only part
that touches a session.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import EvalDatasetRepository
from app.evals.comparison_caveats import comparison_caveats, config_differences
from app.evals.metrics.registry import list_metrics
from app.evals.service import EvalService
from app.evals.wire import to_run_item_read, to_run_read
from app.schemas.enums import EvalQueryDeltaKind
from app.schemas.evals import EvalRunItemRead, EvalRunRead
from app.schemas.evals_comparison import (
    EvalComparisonSide,
    EvalFunnelStageDelta,
    EvalMetricDelta,
    EvalQueryDelta,
    EvalRunComparison,
)
from app.services.errors import InvalidInputError
from app.services.pipelines import PipelineService

#: Below this a delta is float noise, not a movement worth colouring.
_EPSILON = 1e-9


def compare_runs(
    session: Session, user: models.User, run_a_id: UUID, run_b_id: UUID
) -> EvalRunComparison:
    """Resolve both user-owned runs and derive the comparison between them."""
    if run_a_id == run_b_id:
        raise InvalidInputError("Pick two different runs to compare.")
    service = EvalService(session)
    run_a = service.get_run(user, run_a_id)
    run_b = service.get_run(user, run_b_id)
    coverage = service.coverage_for([run_a, run_b])
    items_a = service.list_run_items(user, run_a.id).items
    items_b = service.list_run_items(user, run_b.id).items
    return build_comparison(
        to_run_read(run_a, coverage.get(run_a.id)),
        [to_run_item_read(item) for item in items_a],
        to_run_read(run_b, coverage.get(run_b.id)),
        [to_run_item_read(item) for item in items_b],
        names=_names(session, user, (run_a, run_b)),
    )


def _names(
    session: Session, user: models.User, runs: Sequence[models.EvalRun]
) -> dict[UUID, str]:
    """Display names for the datasets and pipelines the runs point at."""
    datasets = EvalDatasetRepository(session).get_by_ids({run.dataset_id for run in runs})
    names: dict[UUID, str] = {dataset.id: dataset.name for dataset in datasets}
    pipelines = PipelineService(session)
    pipeline_ids = {run.ingestion_pipeline_id for run in runs} | {
        run.retrieval_pipeline_id for run in runs
    }
    # At most four ids (two runs, two pipelines each), and usually two or three
    # once the runs share an ingestion pipeline — a per-id lookup that reuses the
    # service's ownership check beats a batch query that would have to repeat it.
    for pipeline_id in pipeline_ids:
        pipeline = pipelines.get_pipeline(pipeline_id, user.id)
        if pipeline is not None:
            names[pipeline_id] = pipeline.name
    return names


def build_comparison(
    run_a: EvalRunRead,
    items_a: Sequence[EvalRunItemRead],
    run_b: EvalRunRead,
    items_b: Sequence[EvalRunItemRead],
    *,
    names: Mapping[UUID, str],
) -> EvalRunComparison:
    """Derive the whole comparison from two runs and their per-query items."""
    metrics = _metric_deltas(run_a.aggregate_metrics, run_b.aggregate_metrics)
    headline = _headline(run_a.aggregate_metrics, run_b.aggregate_metrics)
    queries = _query_deltas(items_a, items_b, headline)
    caveats = comparison_caveats(
        run_a, run_b, queries, headline_metric=headline[0] if headline else None
    )
    return EvalRunComparison(
        run_a=_side(run_a, items_a, names),
        run_b=_side(run_b, items_b, names),
        metrics_comparable=not caveats,
        caveats=caveats,
        differences=config_differences(run_a, run_b, names),
        metrics=metrics,
        headline_metric=headline[0] if headline else None,
        headline_k=headline[1] if headline else None,
        queries=queries,
        funnel=_funnel_deltas(run_a, run_b),
    )


def _side(
    run: EvalRunRead, items: Sequence[EvalRunItemRead], names: Mapping[UUID, str]
) -> EvalComparisonSide:
    """One run's identity plus the counts that qualify its numbers."""
    return EvalComparisonSide(
        id=run.id,
        name=run.name,
        dataset_id=run.dataset_id,
        dataset_name=names.get(run.dataset_id),
        ingestion_pipeline_id=run.ingestion_pipeline_id,
        ingestion_pipeline_name=names.get(run.ingestion_pipeline_id),
        retrieval_pipeline_id=run.retrieval_pipeline_id,
        retrieval_pipeline_name=names.get(run.retrieval_pipeline_id),
        status=run.status,
        failed_count=run.failed_count,
        unscored_count=run.unscored_count,
        degraded_count=run.degraded_count,
        scored_count=sum(1 for item in items if item.metrics),
        created_at=run.created_at,
    )


def _parse_metric_key(key: str) -> tuple[str, int] | None:
    """Split a `"recall@10"` aggregate key into its metric name and cutoff."""
    name, separator, cutoff = key.rpartition("@")
    if not separator or not name:
        return None
    try:
        return name, int(cutoff)
    except ValueError:
        return None


def _metric_order(*aggregates: Mapping[str, float]) -> list[tuple[str, int]]:
    """Every `(metric, k)` present on either side, in registry then cutoff order."""
    seen: set[tuple[str, int]] = set()
    for aggregate in aggregates:
        for key in aggregate:
            parsed = _parse_metric_key(key)
            if parsed is not None:
                seen.add(parsed)
    registry = [metric.name for metric in list_metrics()]
    rank = {name: index for index, name in enumerate(registry)}
    return sorted(seen, key=lambda entry: (rank.get(entry[0], len(rank)), entry[0], entry[1]))


def _metric_deltas(
    aggregates_a: Mapping[str, float], aggregates_b: Mapping[str, float]
) -> list[EvalMetricDelta]:
    """Every metric at every cutoff either run computed, with B minus A."""
    deltas: list[EvalMetricDelta] = []
    for name, k in _metric_order(aggregates_a, aggregates_b):
        key = f"{name}@{k}"
        value_a = aggregates_a.get(key)
        value_b = aggregates_b.get(key)
        deltas.append(
            EvalMetricDelta(
                metric=name,
                k=k,
                value_a=value_a,
                value_b=value_b,
                delta=(
                    value_b - value_a if value_a is not None and value_b is not None else None
                ),
            )
        )
    return deltas


def _headline(
    aggregates_a: Mapping[str, float], aggregates_b: Mapping[str, float]
) -> tuple[str, int] | None:
    """The metric both runs computed, first in registry order at its deepest k.

    Per-query movement is classified on one metric; picking it from the
    intersection is what keeps a query from reading as "regressed" purely
    because one run never computed the metric it was judged on.
    """
    shared = [
        entry
        for entry in _metric_order(aggregates_a, aggregates_b)
        if f"{entry[0]}@{entry[1]}" in aggregates_a and f"{entry[0]}@{entry[1]}" in aggregates_b
    ]
    if not shared:
        return None
    name = shared[0][0]
    return name, max(k for metric, k in shared if metric == name)


def _query_deltas(
    items_a: Sequence[EvalRunItemRead],
    items_b: Sequence[EvalRunItemRead],
    headline: tuple[str, int] | None,
) -> list[EvalQueryDelta]:
    """Per-query headline scores on both sides, biggest regression first.

    Queries only one run evaluated keep a row: a sample that changed between
    runs is itself a finding, and dropping those rows hides it.
    """
    if headline is None:
        return []
    key = f"{headline[0]}@{headline[1]}"
    by_id_a = {item.query_external_id: item for item in items_a}
    by_id_b = {item.query_external_id: item for item in items_b}
    deltas: list[EvalQueryDelta] = []
    for query_id in list(by_id_a) + [key_b for key_b in by_id_b if key_b not in by_id_a]:
        item_a = by_id_a.get(query_id)
        item_b = by_id_b.get(query_id)
        reference = item_a if item_a is not None else item_b
        if reference is None:  # pragma: no cover - the id came from one of the maps
            continue
        value_a = item_a.metrics.get(key) if item_a else None
        value_b = item_b.metrics.get(key) if item_b else None
        deltas.append(
            EvalQueryDelta(
                query_external_id=query_id,
                query_text=reference.query_text,
                value_a=value_a,
                value_b=value_b,
                delta=(
                    value_b - value_a if value_a is not None and value_b is not None else None
                ),
                kind=_classify(item_a, item_b, value_a, value_b),
                degraded_a=item_a.degraded if item_a else False,
                degraded_b=item_b.degraded if item_b else False,
            )
        )
    return sorted(deltas, key=_query_sort_key)


def _classify(
    item_a: EvalRunItemRead | None,
    item_b: EvalRunItemRead | None,
    value_a: float | None,
    value_b: float | None,
) -> EvalQueryDeltaKind:
    """Which way one query moved, or why it has no movement to report."""
    if item_a is None:
        return EvalQueryDeltaKind.ONLY_B
    if item_b is None:
        return EvalQueryDeltaKind.ONLY_A
    if value_a is None or value_b is None:
        # Both runs evaluated the query and at least one produced no score for
        # the metric under comparison — a failed or unscored query, not a run
        # that never saw it. Reporting it as "only in run B" would claim the
        # other run's sample was different, which is a different finding.
        return EvalQueryDeltaKind.UNSCORED
    if value_b - value_a > _EPSILON:
        return EvalQueryDeltaKind.IMPROVED
    if value_a - value_b > _EPSILON:
        return EvalQueryDeltaKind.REGRESSED
    return EvalQueryDeltaKind.UNCHANGED


def _query_sort_key(delta: EvalQueryDelta) -> tuple[int, float, str]:
    """Regressions first, deepest drop at the top; unmatched queries last."""
    if delta.delta is None:
        return (1, 0.0, delta.query_external_id)
    return (0, delta.delta, delta.query_external_id)


def _funnel_deltas(run_a: EvalRunRead, run_b: EvalRunRead) -> list[EvalFunnelStageDelta]:
    """Gold retention per node, aligned by node id across both runs."""
    stages_a = {stage.node_id: stage for stage in run_a.funnel.stages}
    stages_b = {stage.node_id: stage for stage in run_b.funnel.stages}
    ordered = list(stages_a) + [node_id for node_id in stages_b if node_id not in stages_a]
    deltas: list[EvalFunnelStageDelta] = []
    for node_id in ordered:
        stage_a = stages_a.get(node_id)
        stage_b = stages_b.get(node_id)
        reference = stage_a or stage_b
        if reference is None:  # pragma: no cover - ordered is built from the two maps
            continue
        deltas.append(
            EvalFunnelStageDelta(
                node_id=node_id,
                label=reference.label,
                node_type=reference.node_type,
                retention_a=stage_a.retention if stage_a else None,
                retention_b=stage_b.retention if stage_b else None,
                delta=(
                    stage_b.retention - stage_a.retention
                    if stage_a is not None and stage_b is not None
                    else None
                ),
            )
        )
    return deltas
