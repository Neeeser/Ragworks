"""Wire contract for collection-level diagnostics.

A collection binds an ingestion pipeline and a retrieval pipeline; those two
(plus the indexed data they share) can drift into configurations that make
search empty, misleading, or broken while every individual pipeline still
validates. Diagnostics is the cross-pipeline surface that points such
configurations out without blocking them -- Ragworks is an experiment
workbench, so odd setups stay allowed, they are only flagged.

Every finding is a `CollectionDiagnostic` produced by a registered rule
(`app/services/diagnostics/rules/`); there are no one-off warning strings.
This module owns the wire shape and is hand-mirrored to
`frontend/src/lib/types/diagnostics.ts` in the same PR.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin

DiagnosticSeverity = Literal["error", "warning", "info"]
"""`info` is a neutral/degraded note; the Overview widget counts only
`error` and `warning`."""

DiagnosticConfidence = Literal["confirmed", "heuristic"]
"""`confirmed` = an observed condition; `heuristic` = a risk flag that may be
benign (e.g. same model name on two different connections)."""

DiagnosticCategory = Literal[
    "pipeline_compatibility",
    "embedding",
    "index_config",
    "backend_storage",
    "data_freshness",
    "run_failures",
    "node_config",
]
"""`data_freshness` is a reserved slot (provenance/staleness); no rule ships in
v1."""

DiagnosticResourceKind = Literal[
    "collection", "pipeline", "node", "field", "index", "namespace", "run"
]
DiagnosticLinkKind = Literal["pipeline", "index", "trace", "diagnostic"]


class DiagnosticResource(BaseModel):
    """A concrete thing a diagnostic refers to (a pipeline, node, index, ...)."""

    kind: DiagnosticResourceKind
    id: str | None = None
    name: str | None = None
    pipeline_side: Literal["ingestion", "retrieval"] | None = None


class DiagnosticObservation(BaseModel):
    """An observed value, either paired (ingestion vs retrieval) or single.

    A paired mismatch fills `ingestion` and `retrieval`; a single observed
    value fills `value`.
    """

    label: str
    ingestion: str | None = None
    retrieval: str | None = None
    value: str | None = None


class DiagnosticAction(BaseModel):
    """The primary corrective action -- a frontend route the UI links to."""

    label: str
    route: str


class DiagnosticLink(BaseModel):
    """A navigational link attached to a diagnostic (pipeline, index, trace)."""

    label: str
    route: str
    kind: DiagnosticLinkKind


class CollectionDiagnostic(BaseModel):
    """One diagnostic finding.

    Superset of the single-pipeline `PipelineValidationIssue`: `code` is the
    stable identifier (e.g. `"embedding_model_mismatch"`), and the finding
    carries the resources, observations, and links a reader needs to act on it.
    """

    code: str
    severity: DiagnosticSeverity
    confidence: DiagnosticConfidence
    category: DiagnosticCategory
    title: str
    summary: str
    resources: list[DiagnosticResource] = Field(default_factory=list)
    observations: list[DiagnosticObservation] = Field(default_factory=list)
    action: DiagnosticAction | None = None
    links: list[DiagnosticLink] = Field(default_factory=list)


class DiagnosticsSummary(DateTimeConfigMixin, BaseModel):
    """A set of findings plus the counts and verdict derived from them.

    The Overview widget reads `error_count`/`warning_count`/`consistent`; the
    Diagnostics tab renders `diagnostics` grouped by `category`. `consistent`
    is derived: true when no `error`-severity diagnostic exists in the
    `embedding`, `index_config`, `backend_storage`, or `pipeline_compatibility`
    categories -- it deliberately ignores `run_failures` and `node_config`.

    Served for a persisted collection as `CollectionDiagnosticsResponse` and
    for a not-yet-created one as the preview response, which is this shape
    exactly: the two must carry the same counts and verdict, so the wizard's
    warning and the Diagnostics tab never disagree about the same pairing.
    """

    generated_at: datetime
    error_count: int
    warning_count: int
    consistent: bool
    diagnostics: list[CollectionDiagnostic] = Field(default_factory=list)


class CollectionDiagnosticsResponse(DiagnosticsSummary):
    """The full diagnostics payload for one persisted collection."""

    collection_id: UUID


class CollectionDiagnosticsPreviewRequest(BaseModel):
    """A collection configuration the user has chosen but not yet created.

    Mirrors the create payload's pipeline fields (`CollectionCreate`): the
    ingest pipeline and the tool pipelines in binding order, the first being
    the primary search tool. A side left unset simply resolves to nothing and
    its comparison rules stay silent. The collection's name is deliberately
    absent -- no rule reads it, so sending it would only re-run the preview
    on every keystroke.
    """

    ingest_pipeline_id: UUID | None = None
    tool_pipeline_ids: list[UUID] = Field(default_factory=list)
