"""Wire contract for the Evals feature: datasets, runs, metrics, and trace attribution.

These Pydantic models are the API contract for benchmark retrieval evaluation.
They are hand-mirrored in `frontend/src/lib/types/evals.ts`; a change here changes
the mirror in the same PR. Persistence lives in `app/db/models/evals.py` and is
converted to these shapes at the service boundary.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.enums import (
    EvalDatasetSource,
    EvalDatasetStatus,
    EvalFindingSeverity,
    EvalRunStatus,
    RelevanceGranularity,
)

DEFAULT_K_VALUES: tuple[int, ...] = (1, 5, 10, 25)


# --------------------------------------------------------------------------- #
# Datasets
# --------------------------------------------------------------------------- #


class BuiltinDatasetInfo(BaseModel):
    """One entry in the curated benchmark registry, before it is imported.

    `key` is the stable registry identifier passed to import a builtin
    benchmark; the counts are advisory (from the registry manifest) so the UI
    can warn about run cost before download.
    """

    key: str
    name: str
    description: str
    num_queries: int
    num_corpus_docs: int


class EvalDatasetRead(BaseModel):
    """An imported eval dataset the run engine can evaluate against."""

    id: UUID
    name: str
    description: str | None = None
    source: EvalDatasetSource
    source_ref: str | None = None
    relevance_granularity: RelevanceGranularity
    status: EvalDatasetStatus
    error_message: str | None = None
    num_queries: int
    num_corpus_docs: int
    created_at: datetime
    updated_at: datetime


class ImportBuiltinDatasetRequest(BaseModel):
    """Request to import a curated benchmark by its registry key."""

    key: str
    name: str | None = Field(
        default=None,
        description="Optional display name; defaults to the registry entry's name.",
    )


# --------------------------------------------------------------------------- #
# Metric catalog
# --------------------------------------------------------------------------- #


class EvalMetricInfo(BaseModel):
    """A registered retrieval metric, for selection and tooltip display.

    `description` is the human explanation rendered in the metric's tooltip;
    `is_rank_aware` lets the UI group rank-based (MRR/nDCG/MAP) separately from
    set-based (Recall/Precision/Hit) metrics.
    """

    name: str
    label: str
    description: str
    is_rank_aware: bool


# --------------------------------------------------------------------------- #
# Run configuration
# --------------------------------------------------------------------------- #


class EvalRunConfig(BaseModel):
    """The knobs that scope and score an eval run.

    `run_inputs` binds the retrieval pipeline's declared variables (everything
    except the per-item query) once for the whole run. Gold documents for the
    sampled queries are always included in the corpus regardless of
    `distractor_pool_size`.
    """

    num_queries: int = Field(gt=0, description="How many benchmark queries to sample.")
    distractor_pool_size: int = Field(
        ge=0,
        description="Random non-gold docs added to the corpus alongside every gold doc.",
    )
    seed: int = Field(default=0, description="Sampling seed; fixes reproducibility.")
    concurrency: int = Field(
        default=4,
        ge=1,
        le=8,
        description=(
            "Retrieval queries (and corpus ingestions) in flight at once. Provider"
            " capacity is not discoverable, so this is a user-set ceiling."
        ),
    )
    k_values: list[int] = Field(
        default_factory=lambda: list(DEFAULT_K_VALUES),
        description="Cutoffs at which @k metrics are computed.",
    )
    selected_metrics: list[str] = Field(
        default_factory=list,
        description="Metric names to compute; empty means every registered metric.",
    )
    run_inputs: dict[str, object] = Field(
        default_factory=dict,
        description="Values bound once for the retrieval pipeline's declared variables.",
    )


class EvalRunCreate(BaseModel):
    """Request to start a new eval run."""

    dataset_id: UUID
    ingestion_pipeline_id: UUID
    retrieval_pipeline_id: UUID
    name: str | None = None
    config: EvalRunConfig


# --------------------------------------------------------------------------- #
# Trace attribution: funnel + findings
# --------------------------------------------------------------------------- #


class FunnelStage(BaseModel):
    """Aggregate gold-document retention at one pipeline node (or ingestion).

    `node_id` is the pipeline node instance id (or the sentinel `"ingestion"`
    for indexed coverage); `node_type` and `label` address it in the graph so a
    finding can name the exact node. `gold_retained` / `gold_total` are summed
    across every evaluated query.
    """

    node_id: str
    node_type: str
    label: str
    gold_retained: int
    gold_total: int
    retention: float


class EvalFinding(BaseModel):
    """A node-addressed, deterministic recommendation derived from the funnel."""

    node_id: str
    label: str
    severity: EvalFindingSeverity
    category: str
    message: str


class FunnelSummary(BaseModel):
    """The whole run's recall funnel plus the findings derived from it."""

    stages: list[FunnelStage] = Field(default_factory=list)
    findings: list[EvalFinding] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Runs and per-query items
# --------------------------------------------------------------------------- #


class EvalRetrievedChunk(BaseModel):
    """One retrieved chunk within an evaluated query, in rank order."""

    chunk_id: str | None = None
    document_id: str
    score: float | None = None


class EvalItemNodeDocs(BaseModel):
    """The documents one pipeline node emitted for one evaluated query.

    `node_id` matches the run-level funnel stages (including the `"ingestion"`
    sentinel), so the UI can render a per-document retained/dropped path across
    the same stage sequence.
    """

    node_id: str
    document_ids: list[str]


class EvalRunItemRead(BaseModel):
    """One evaluated query's result within a run."""

    id: UUID
    query_external_id: str
    query_text: str
    pipeline_run_id: UUID | None = None
    query_event_id: UUID | None = None
    result_count: int
    gold_doc_ids: list[str]
    retrieved_document_ids: list[str]
    retrieved: list[EvalRetrievedChunk] = Field(default_factory=list)
    per_node_funnel: list[EvalItemNodeDocs] = Field(default_factory=list)
    metrics: dict[str, float]
    failed: bool = False
    error_message: str | None = None


class EvalRunItemsResponse(BaseModel):
    """A run's per-query items plus display titles for the documents involved.

    `document_titles` maps external doc ids (gold and retrieved) to their
    corpus titles so the UI can name documents instead of showing raw ids.
    """

    items: list[EvalRunItemRead]
    document_titles: dict[str, str] = Field(default_factory=dict)


class EvalRunRead(BaseModel):
    """An eval run's status, progress, and (once complete) results."""

    id: UUID
    name: str | None = None
    dataset_id: UUID
    eval_collection_id: UUID | None = None
    ingestion_pipeline_id: UUID
    retrieval_pipeline_id: UUID
    status: EvalRunStatus
    config: EvalRunConfig
    progress_done: int
    progress_total: int
    aggregate_metrics: dict[str, float] = Field(default_factory=dict)
    funnel: FunnelSummary = Field(default_factory=FunnelSummary)
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class EvalRunSummary(BaseModel):
    """Compact run row for list views."""

    id: UUID
    name: str | None = None
    dataset_id: UUID
    status: EvalRunStatus
    progress_done: int
    progress_total: int
    aggregate_metrics: dict[str, float] = Field(default_factory=dict)
    created_at: datetime


# --------------------------------------------------------------------------- #
# Eval-collection management
# --------------------------------------------------------------------------- #


class EvalCollectionRead(BaseModel):
    """A provisioned eval collection, shown on the benchmark-collections page."""

    id: UUID
    name: str
    dataset_id: UUID | None = None
    ingestion_pipeline_id: UUID | None = None
    num_documents: int
    num_chunks: int
    created_at: datetime
    updated_at: datetime
