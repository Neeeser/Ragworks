"""Domain enums shared by the wire contract (`app/schemas/`) and persistence
(`app/db/models/`).

These live in `app/schemas` — not `app/db` — because the wire contract must not
transitively depend on SQLModel: `db.models` imports these enums, never the
reverse.
"""

from __future__ import annotations

from enum import Enum


class ChunkStrategy(str, Enum):
    """Chunking strategies for documents."""

    TOKEN = "token"
    SENTENCE = "sentence"
    PARAGRAPH = "paragraph"
    SEMANTIC = "semantic"


class FileNodeKind(str, Enum):
    """Node kinds in a collection's file tree."""

    FOLDER = "folder"
    FILE = "file"


class DocumentStatus(str, Enum):
    """Status values for document processing."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    UNSUPPORTED = "unsupported"
    """No parse node in the collection's pipeline reads this file's type.

    Terminal like FAILED, but not a failure: nothing went wrong, the pipeline
    simply does not read this format. Retrying runs the same graph against the
    same bytes, so surfaces offer the pipeline rather than a retry.
    """


class ChatMode(str, Enum):
    """Chat mode selections."""

    QUERY = "query"
    CHAT = "chat"


class ChatRole(str, Enum):
    """Roles assigned to chat messages."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"
    ERROR = "error"


class PipelineKind(str, Enum):
    """Derived pipeline categories for wire/UI grouping.

    No longer stored: a pipeline's category is derived from its interface
    (`accepts_document` -> ingestion, `callable` -> retrieval). The enum
    remains the wire vocabulary the pipelines list/read endpoints group by.
    """

    INGESTION = "ingestion"
    RETRIEVAL = "retrieval"


class BindingRole(str, Enum):
    """How a collection uses a bound pipeline.

    `INGEST` runs on file ingestion (one per collection, service-enforced);
    `TOOL` is exposed as a callable tool (many per collection). Values are
    permanent — future triggers (schedules, sub-pipeline mounts) are new
    members, never reinterpretations. Pipeline runs record the same
    vocabulary as their `trigger`.
    """

    INGEST = "ingest"
    TOOL = "tool"


class PipelineRunStatus(str, Enum):
    """Execution status values for pipeline runs and node runs.

    `DEGRADED` is a node that produced output after absorbing a failure it
    was configured to pass through (an LLM call exhausted on a 429 emitting
    its input unchanged), and a run holding at least one such node. It is a
    third terminal state on purpose: reporting it as `COMPLETED` makes a run
    where a step never executed indistinguishable from one where it did.
    """

    RUNNING = "running"
    COMPLETED = "completed"
    DEGRADED = "degraded"
    FAILED = "failed"


class PipelineIOType(str, Enum):
    """Direction of pipeline node input/output payloads."""

    INPUT = "input"
    OUTPUT = "output"


class IndexBackend(str, Enum):
    """Vector-store backends a pipeline can index into and query from."""

    PINECONE = "pinecone"
    PGVECTOR = "pgvector"


class ProviderType(str, Enum):
    """External provider types a user can register connections for.

    Values are persisted in `provider_connections.provider_type` and are
    permanent — add new ones, never rename existing ones.
    """

    OPENROUTER = "openrouter"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    COHERE = "cohere"
    TEI = "tei"
    CUSTOM = "custom"
    PINECONE = "pinecone"


class ProviderKind(str, Enum):
    """Capability kinds a provider connection can serve."""

    EMBEDDING = "embedding"
    CHAT = "chat"
    RERANKING = "reranking"
    VECTOR_STORE = "vector_store"


class UserRole(str, Enum):
    """Privilege tiers for user accounts."""

    ADMIN = "admin"
    USER = "user"


class ApiKeyCapability(str, Enum):
    """What an API key is provisioned to do on the MCP endpoint.

    Values are persisted in `api_keys.capabilities` and are permanent — a new
    capability is a new member, never a reinterpretation of an existing one.
    Every MCP tool declares the capability it needs, so an unprovisioned
    capability's tools are absent from `tools/list` and rejected in
    `tools/call`.
    """

    TOOLS_INVOKE = "tools:invoke"
    FILES_READ = "files:read"
    FILES_WRITE = "files:write"


class PipelineMarkerKind(str, Enum):
    """A pipeline change plotted on the collection activity timeline.

    `VERSION` is a saved `PipelineVersion`; `TOOL_ADDED` is the moment a
    pipeline was bound to the collection as a tool. Unbinding has no member
    because bindings are hard-deleted, so that history does not exist.
    """

    VERSION = "version"
    TOOL_ADDED = "tool_added"


class CollectionPurpose(str, Enum):
    """System role of a collection.

    A normal user collection carries no purpose (the column is NULL); an
    eval-owned collection is transient scaffolding materialized from a
    benchmark corpus and is excluded from the user-facing Collections page.
    Values are persisted -- add new ones, never rename existing ones.
    """

    EVAL = "eval"


class EvalDatasetSource(str, Enum):
    """Where an eval dataset's corpus/queries/qrels came from.

    `SYNTHETIC` datasets are generated from one of the user's collections by
    `app/evals/generation/`. Values are persisted -- add new ones, never
    rename existing ones.
    """

    BUILTIN_BENCHMARK = "builtin_benchmark"
    CUSTOM_UPLOAD = "custom_upload"
    SYNTHETIC = "synthetic"


class EvalDatasetStatus(str, Enum):
    """Lifecycle of an eval dataset's stored corpus/queries/qrels."""

    PENDING = "pending"
    DOWNLOADING = "downloading"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"


class EvalQuestionType(str, Enum):
    """The synthetic-generation question shapes a dataset can mix.

    Persisted inside `EvalDatasetQuery.query_metadata` -- add new values,
    never rename existing ones.
    """

    SINGLE_FACT = "single_fact"
    PARAPHRASED = "paraphrased"
    MULTI_DETAIL = "multi_detail"


class EvalModality(str, Enum):
    """Content modality of an eval dataset record.

    Persisted on the dataset row's modality list, on its corpus and query
    records, and inside `EvalDatasetQuery.query_metadata` -- add new values,
    never rename existing ones.
    """

    TEXT = "text"
    IMAGE = "image"


class RelevanceGranularity(str, Enum):
    """Granularity at which relevance judgments (qrels) are expressed.

    Benchmark qrels are per-document; a retrieved chunk counts toward a gold
    document when its parent document is in the gold set. `CHUNK` is reserved
    for future synthetic datasets that label individual chunks.
    """

    DOCUMENT = "document"
    CHUNK = "chunk"


class EvalRunStatus(str, Enum):
    """Execution status values for an eval run."""

    PENDING = "pending"
    PROVISIONING = "provisioning"
    INGESTING = "ingesting"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class EvalFindingSeverity(str, Enum):
    """How strongly a trace-attribution finding is flagged to the user."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class EvalComparisonCaveatCode(str, Enum):
    """Why two eval runs' metrics do not describe the same measurement."""

    DIFFERENT_DATASETS = "different_datasets"
    DEGRADED_RUN = "degraded_run"
    UNFINISHED_RUN = "unfinished_run"
    DISJOINT_QUERIES = "disjoint_queries"
    NO_SHARED_METRIC = "no_shared_metric"


class EvalQueryDeltaKind(str, Enum):
    """How one query's score moved between two eval runs.

    `UNSCORED` is a query both runs evaluated where at least one produced no
    score for the metric under comparison — distinct from `ONLY_A`/`ONLY_B`,
    which mean the other run never saw the query at all.
    """

    IMPROVED = "improved"
    REGRESSED = "regressed"
    UNCHANGED = "unchanged"
    UNSCORED = "unscored"
    ONLY_A = "only_a"
    ONLY_B = "only_b"


class InsightSpace(str, Enum):
    """Which vector space a collection insight snapshot was computed in."""

    SEMANTIC = "semantic"
    LEXICAL = "lexical"


class InsightStatus(str, Enum):
    """Lifecycle status of a collection insight snapshot."""

    COMPUTING = "computing"
    READY = "ready"
    FAILED = "failed"


class PromptContext(str, Enum):
    """Where a saved prompt is used.

    The context binds a prompt to its variable catalog, the pickers that
    list it, and the test harness the studio runs it in. It is metadata on
    the entity, never a constraint on the text — forking across contexts
    re-validates variables and changes nothing else.
    """

    CHAT_BASE = "chat.base"
    CHAT_TOOL = "chat.tool"
    NODE_TRANSFORM = "node.transform"
    NODE_RERANK = "node.rerank"
    NODE_GENERATE = "node.generate"


class PromptSource(str, Enum):
    """Whether a prompt was created by the user or shipped with Ragworks.

    Shipped prompts carry a stable `shipped_key`; a release that improves a
    default appends a new version to the matching row, so consumers on
    `latest` pick it up while pinned or forked prompts stay put.
    """

    USER = "user"
    SHIPPED = "shipped"


class ShortlistEntryType(str, Enum):
    """How a model earned its place on a user's shortlist.

    Pins are explicit (the user starred the model); recents are recorded
    automatically when a model is selected, and are pruned to a cap.
    """

    PINNED = "pinned"
    RECENT = "recent"
