"""Wire contract for an eval run: configuration, metrics, results, attribution.

The dataset and eval-collection shapes a run is pointed at live in
`app/schemas/evals_corpus.py`. These Pydantic models are hand-mirrored in
`frontend/src/lib/types/evals.ts`; a change here changes the mirror in the same
PR. Persistence lives in `app/db/models/evals.py` and is converted to these
shapes at the service boundary.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.enums import EvalFindingSeverity, EvalRunStatus
from app.schemas.evals_usage import EvalRunUsage
from app.schemas.media import MediaAssetRef

DEFAULT_K_VALUES: tuple[int, ...] = (1, 5, 10, 25)


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


class PromptComparisonRequest(BaseModel):
    """Request to A/B two versions of one prompt.

    `retrieval_pipeline_id` names the pipeline whose nodes reference the
    prompt; each side runs a copy of it with those references pinned, so
    the two runs differ in exactly one thing and each names a pipeline
    that describes what it did.
    """

    prompt_id: UUID
    version_a: int = Field(gt=0)
    version_b: int = Field(gt=0)
    dataset_id: UUID
    ingestion_pipeline_id: UUID
    retrieval_pipeline_id: UUID
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
    """One retrieved chunk within an evaluated query, in rank order.

    `media` is the stored image the chunk stands for, when it has one — an
    image result is what an image-retrieval run is judged on. Optional, so
    the items of a run recorded before the field still read.
    """

    chunk_id: str | None = None
    document_id: str
    score: float | None = None
    media: MediaAssetRef | None = None


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
    #: The dataset query's stored image, resolved at read time from the
    #: dataset rather than copied onto the item row — an image query has no
    #: text, so without it the row renders blank.
    query_media: MediaAssetRef | None = None
    pipeline_run_id: UUID | None = None
    query_event_id: UUID | None = None
    result_count: int
    gold_doc_ids: list[str]
    #: The subset of `gold_doc_ids` that reached the index. Fewer than
    #: `gold_doc_ids` means the query was scored against partial evidence;
    #: empty (with gold present) means it was excluded from the aggregate.
    indexed_gold_doc_ids: list[str] = []
    retrieved_document_ids: list[str]
    retrieved: list[EvalRetrievedChunk] = Field(default_factory=list)
    per_node_funnel: list[EvalItemNodeDocs] = Field(default_factory=list)
    metrics: dict[str, float]
    failed: bool = False
    #: A node in this query's retrieval run passed its input through after a
    #: provider failure — the metrics beside it describe a pipeline that
    #: partly did not run.
    degraded: bool = False
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
    #: Documents materialized in the eval collection that did not reach the
    #: index — what a corpus retry would repair, and zero once it has.
    corpus_unindexed: int = 0
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
    #: Queries excluded from `aggregate_metrics` because none of their gold
    #: documents were indexed — an ingestion outcome, not a retrieval one.
    unscored_count: int = 0
    #: Queries scored on a run holding a degraded node. They are included in
    #: the aggregates, so this count is what says the run is not a clean
    #: comparison.
    degraded_count: int = 0
    coverage: EvalRunCoverage | None = None
    aggregate_metrics: dict[str, float] = Field(default_factory=dict)
    funnel: FunnelSummary = Field(default_factory=FunnelSummary)
    #: Embedding spend this run incurred, split by phase. None for a run that
    #: predates usage accounting or performed no measured work.
    usage: EvalRunUsage | None = None
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
    #: Queries excluded from `aggregate_metrics` because none of their gold
    #: documents were indexed — an ingestion outcome, not a retrieval one.
    unscored_count: int = 0
    #: Queries scored on a run holding a degraded node.
    degraded_count: int = 0
    coverage: EvalRunCoverage | None = None
    aggregate_metrics: dict[str, float] = Field(default_factory=dict)
    #: Token/cost totals, so the list can carry a spend column beside score.
    usage: EvalRunUsage | None = None
    created_at: datetime

