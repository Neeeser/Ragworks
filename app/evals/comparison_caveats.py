"""Whether two eval runs' numbers describe the same measurement.

Kept apart from the delta derivation because it answers the other half of the
question: `run_comparison.py` computes what moved, this computes whether the
movement counts. Both halves ship together — a delta rendered without its
caveat is the misreading this module exists to prevent.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from uuid import UUID

from app.schemas.enums import EvalComparisonCaveatCode, EvalRunStatus
from app.schemas.evals import EvalRunRead
from app.schemas.evals_comparison import (
    EvalComparisonCaveat,
    EvalConfigDifference,
    EvalQueryDelta,
)


def config_differences(
    run_a: EvalRunRead, run_b: EvalRunRead, names: Mapping[UUID, str]
) -> list[EvalConfigDifference]:
    """Every configuration field the two runs disagree on.

    Only a differing dataset invalidates: a differing search tool or ingestion
    pipeline is the thing under test, and a differing sample is a scope note.
    """

    def named(value: UUID) -> str:
        return names.get(value, str(value))

    candidates: list[EvalConfigDifference] = [
        EvalConfigDifference(
            label="Dataset",
            value_a=named(run_a.dataset_id),
            value_b=named(run_b.dataset_id),
            invalidates=run_a.dataset_id != run_b.dataset_id,
        ),
        EvalConfigDifference(
            label="Ingestion",
            value_a=named(run_a.ingestion_pipeline_id),
            value_b=named(run_b.ingestion_pipeline_id),
        ),
        EvalConfigDifference(
            label="Search tool",
            value_a=named(run_a.retrieval_pipeline_id),
            value_b=named(run_b.retrieval_pipeline_id),
        ),
        EvalConfigDifference(
            label="Queries",
            value_a=str(run_a.config.num_queries),
            value_b=str(run_b.config.num_queries),
        ),
        EvalConfigDifference(
            label="Distractors",
            value_a=str(run_a.config.distractor_pool_size),
            value_b=str(run_b.config.distractor_pool_size),
        ),
        EvalConfigDifference(
            label="Seed",
            value_a=str(run_a.config.seed),
            value_b=str(run_b.config.seed),
        ),
        EvalConfigDifference(
            label="k",
            value_a="/".join(str(k) for k in run_a.config.k_values),
            value_b="/".join(str(k) for k in run_b.config.k_values),
        ),
    ]
    return [entry for entry in candidates if entry.value_a != entry.value_b]


def comparison_caveats(
    run_a: EvalRunRead,
    run_b: EvalRunRead,
    queries: Sequence[EvalQueryDelta],
    *,
    headline_metric: str | None,
) -> list[EvalComparisonCaveat]:
    """Every reason the two runs' metrics are not a clean comparison."""
    caveats: list[EvalComparisonCaveat] = []
    if headline_metric is None:
        caveats.append(
            EvalComparisonCaveat(
                code=EvalComparisonCaveatCode.NO_SHARED_METRIC,
                message=(
                    "The two runs computed no metric in common, so there is nothing to "
                    "compare them on — the scores below belong to one run or the other."
                ),
            )
        )
    if run_a.dataset_id != run_b.dataset_id:
        caveats.append(
            EvalComparisonCaveat(
                code=EvalComparisonCaveatCode.DIFFERENT_DATASETS,
                message=(
                    "These runs scored different datasets, so their metrics measure "
                    "different things and the deltas below are not a comparison."
                ),
            )
        )
    for run, label in ((run_a, "A"), (run_b, "B")):
        if run.degraded_count > 0:
            caveats.append(
                EvalComparisonCaveat(
                    code=EvalComparisonCaveatCode.DEGRADED_RUN,
                    message=(
                        f"Run {label} scored {run.degraded_count} "
                        f"{'query' if run.degraded_count == 1 else 'queries'} on a degraded "
                        "node — a step passed its input through after its provider failed, so "
                        "that side measured a pipeline that only partly ran."
                    ),
                )
            )
        if run.status is not EvalRunStatus.COMPLETED:
            caveats.append(
                EvalComparisonCaveat(
                    code=EvalComparisonCaveatCode.UNFINISHED_RUN,
                    message=(
                        f"Run {label} is {run.status.value}, so its aggregates cover only the "
                        "queries it managed to score."
                    ),
                )
            )
    if queries and not any(query.delta is not None for query in queries):
        caveats.append(
            EvalComparisonCaveat(
                code=EvalComparisonCaveatCode.DISJOINT_QUERIES,
                message=(
                    "The two runs share no scored query, so nothing below is a per-query "
                    "comparison."
                ),
            )
        )
    return caveats
