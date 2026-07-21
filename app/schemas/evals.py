"""Wire contract for the Evals feature: datasets, runs, metrics, and trace attribution.

These Pydantic models are the API contract for benchmark retrieval evaluation.
They are hand-mirrored in `frontend/src/lib/types/evals.ts`; a change here changes
the mirror in the same PR. Persistence lives in `app/db/models/evals.py` and is
converted to these shapes at the service boundary.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.enums import (
    DocumentStatus,
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
    can warn about run cost before download. `domain` and `measures` tell the
    user what the benchmark's corpus covers and what a score on it indicates,
    so results across benchmarks can be read as domain strengths/weaknesses.
    """

    key: str
    name: str
    description: str
    domain: str
    measures: str
    num_queries: int
    num_corpus_docs: int


class EvalDatasetRead(BaseModel):
    """An imported or generated eval dataset the run engine can evaluate against.

    `progress_done`/`progress_total` count accepted questions while a synthetic
    dataset is `generating`; `generation_config` echoes the request that
    produced it (both zero/None for benchmark and uploaded datasets).
    """

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
    progress_done: int = 0
    progress_total: int = 0
    generation_config: dict[str, object] | None = None
    created_at: datetime
    updated_at: datetime


class ImportBuiltinDatasetRequest(BaseModel):
    """Request to import a curated benchmark by its registry key."""

    key: str
    name: str | None = Field(
        default=None,
        description="Optional display name; defaults to the registry entry's name.",
    )


class UploadDatasetRequest(BaseModel):
    """A user-uploaded dataset, as BEIR-format file contents."""

    name: str
    description: str | None = None
    corpus: str
    queries: str
    qrels: str


class EvalDatasetDocumentRead(BaseModel):
    """A dataset corpus document's stored source text, for inline viewing."""

    external_doc_id: str
    title: str | None = None
    text: str


class EvalCollectionDocument(BaseModel):
    """One corpus document materialized in an eval collection, with its
    ingestion outcome. `document_id` addresses the document ingestion trace."""

    document_id: UUID
    external_doc_id: str
    title: str | None = None
    status: DocumentStatus
    error_message: str | None = None
    num_chunks: int


class EvalCollectionDocumentsPage(BaseModel):
    """One page of an eval collection's documents plus the total match count."""

    total: int
    items: list[EvalCollectionDocument] = Field(default_factory=list)


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

    @field_validator("k_values")
    @classmethod
    def _positive_cutoffs(cls, value: list[int]) -> list[int]:
        """Reject non-positive cutoffs; `name@0` would be meaningless."""
        if any(k <= 0 for k in value):
            raise ValueError("Every k_values cutoff must be a positive integer.")
        return value


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


class EvalRunCoverage(BaseModel):
    """How much of the dataset a run covered, computed at read time.

    Corpus counts come from the run's eval collection (READY documents over
    the dataset's full corpus); query counts are evaluated items over the
    dataset's full query set.
    """

    corpus_ingested: int
    corpus_total: int
    queries_done: int
    queries_total: int


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
    failed_count: int = 0
    coverage: EvalRunCoverage | None = None
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
    failed_count: int = 0
    coverage: EvalRunCoverage | None = None
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
    num_ready_documents: int = 0
    num_chunks: int
    created_at: datetime
    updated_at: datetime
