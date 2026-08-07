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
    EvalModality,
    RelevanceGranularity,
)
from app.schemas.media import MediaAssetRef


class BuiltinDatasetInfo(BaseModel):
    """One entry in the curated benchmark registry, before it is imported.

    `key` is the stable registry identifier passed to import a builtin
    benchmark; the counts are advisory (from the registry manifest) so the UI
    can warn about run cost before download. `domain` and `measures` tell the
    user what the benchmark's corpus covers and what a score on it indicates,
    so results across benchmarks can be read as domain strengths/weaknesses.
    `modalities`, `license_name`, and `approx_download_mb` are what a user
    weighs before starting an import that may take minutes and hundreds of
    megabytes.
    """

    key: str
    name: str
    description: str
    domain: str
    measures: str
    num_queries: int
    num_corpus_docs: int
    modalities: list[EvalModality] = Field(default_factory=lambda: [EvalModality.TEXT])
    license_name: str
    approx_download_mb: int


class EvalDatasetRead(BaseModel):
    """An imported or generated eval dataset the run engine can evaluate against.

    `progress_done`/`progress_total` count accepted questions while a synthetic
    dataset is `generating` and fetched corpus documents while a benchmark is
    `downloading`; `generation_config` echoes the request that produced it
    (both zero/None for benchmark and uploaded datasets). `modalities` is what
    the dataset's records actually carry, so a run wizard can tell an image
    benchmark from a text one without loading its corpus.
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
    modalities: list[EvalModality] = Field(default_factory=lambda: [EvalModality.TEXT])
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
    """A dataset corpus document's stored source, for inline viewing.

    A page-image document carries `media` and no text; a document may carry
    both, and the viewer renders whichever it was given.
    """

    external_doc_id: str
    title: str | None = None
    text: str | None = None
    media: MediaAssetRef | None = None


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
# Eval-collection management
# --------------------------------------------------------------------------- #


class EvalCollectionRead(BaseModel):
    """A provisioned eval collection, shown on the benchmark-collections page."""

    id: UUID
    name: str
    dataset_id: UUID | None = None
    ingestion_pipeline_id: UUID | None = None
    num_documents: int
    num_indexed_documents: int = 0
    num_chunks: int
    created_at: datetime
    updated_at: datetime
