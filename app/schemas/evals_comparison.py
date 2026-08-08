"""Wire contract for a diff between two eval runs.

The core eval loop is change one thing, re-run, compare, so these shapes
carry both halves of the answer: what moved (metric deltas, per-query
classification, gold retention per node) and whether the move means
anything (the configuration differences and the caveats derived from them).

Comparability is reported, never enforced — a mismatched pair still renders
its numbers, labelled with what makes them incomparable. Hand-mirrored in
`frontend/src/lib/types/evals.ts`.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.enums import EvalComparisonCaveatCode, EvalQueryDeltaKind, EvalRunStatus


class EvalComparisonSide(BaseModel):
    """One run's identity and the counts that qualify its numbers."""

    id: UUID
    name: str | None = None
    dataset_id: UUID
    dataset_name: str | None = None
    ingestion_pipeline_id: UUID
    ingestion_pipeline_name: str | None = None
    retrieval_pipeline_id: UUID
    retrieval_pipeline_name: str | None = None
    status: EvalRunStatus
    failed_count: int = 0
    unscored_count: int = 0
    degraded_count: int = 0
    scored_count: int = 0
    created_at: datetime


class EvalConfigDifference(BaseModel):
    """One configuration field the two runs disagree on.

    `invalidates` marks a difference that makes the metric comparison
    meaningless rather than merely noteworthy — a different dataset is a
    different measurement, a different search tool is the thing under test.
    """

    label: str
    value_a: str
    value_b: str
    invalidates: bool = False


class EvalComparisonCaveat(BaseModel):
    """A reason the two runs' metrics are not a clean comparison."""

    code: EvalComparisonCaveatCode
    message: str


class EvalMetricDelta(BaseModel):
    """One metric at one cutoff on both sides.

    `delta` is `value_b - value_a`, and is null whenever either side did not
    compute the metric — a missing value is not a zero.
    """

    metric: str
    k: int
    value_a: float | None = None
    value_b: float | None = None
    delta: float | None = None


class EvalQueryDelta(BaseModel):
    """One query's headline score on both sides, and which way it moved."""

    query_external_id: str
    query_text: str
    value_a: float | None = None
    value_b: float | None = None
    delta: float | None = None
    kind: EvalQueryDeltaKind
    degraded_a: bool = False
    degraded_b: bool = False


class EvalFunnelStageDelta(BaseModel):
    """Gold retention at one node, aligned across both runs by node id.

    A node present on one side only keeps its row with the other side null:
    two runs on different pipelines share no node ids beyond the `"ingestion"`
    sentinel, and dropping the unmatched rows would render an empty chart.
    """

    node_id: str
    label: str
    node_type: str
    retention_a: float | None = None
    retention_b: float | None = None
    delta: float | None = None


class EvalRunComparison(BaseModel):
    """Two eval runs side by side, with the deltas between them."""

    run_a: EvalComparisonSide
    run_b: EvalComparisonSide
    #: False when a caveat invalidates the metric comparison. The deltas are
    #: still computed and returned; this is what labels them.
    metrics_comparable: bool = True
    caveats: list[EvalComparisonCaveat] = Field(default_factory=list)
    differences: list[EvalConfigDifference] = Field(default_factory=list)
    metrics: list[EvalMetricDelta] = Field(default_factory=list)
    #: The metric and cutoff the per-query classification used, null when the
    #: two runs share no computed metric.
    headline_metric: str | None = None
    headline_k: int | None = None
    queries: list[EvalQueryDelta] = Field(default_factory=list)
    funnel: list[EvalFunnelStageDelta] = Field(default_factory=list)
