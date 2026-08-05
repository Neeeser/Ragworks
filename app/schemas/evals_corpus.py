"""Wire contract for what an eval runs *against*: datasets and their corpora.

A dataset is the benchmark (corpus, queries, relevance judgments); an eval
collection is that corpus materialized and ingested through the pipeline under
test. Run-side shapes live in `app/schemas/evals.py`. These are hand-mirrored in
`frontend/src/lib/types/evals.ts`; a change here changes the mirror in the same
PR.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.enums import (
    DocumentStatus,
    EvalDatasetSource,
    EvalDatasetStatus,
    RelevanceGranularity,
)


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


class EvalCorpusRetryResponse(BaseModel):
    """How many corpus documents were requeued for ingestion."""

    queued: int


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
