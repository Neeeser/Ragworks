"""The dataset abstraction shared by every eval dataset source.

A dataset is the BEIR triple — corpus, queries, and relevance judgments (qrels).
A curated benchmark, a user's uploaded dataset, and a future synthetic
generator all resolve to the same `DatasetTriple`, so the run engine consumes one
shape regardless of where the data came from.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.enums import RelevanceGranularity


@dataclass(frozen=True)
class CorpusDoc:
    """One corpus document, keyed by its dataset-native external id."""

    external_doc_id: str
    text: str
    title: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class QueryRecord:
    """One query, keyed by its dataset-native external id.

    `metadata` is populated by synthetic generation (question type, critique
    scores, source chunk ids); benchmark and uploaded queries leave it empty.
    """

    external_query_id: str
    text: str
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Qrel:
    """One relevance judgment: (query, document) with a relevance grade."""

    query_external_id: str
    doc_external_id: str
    relevance: int = 1


@dataclass(frozen=True)
class DatasetTriple:
    """A complete eval dataset ready to persist and evaluate against."""

    name: str
    corpus: list[CorpusDoc]
    queries: list[QueryRecord]
    qrels: list[Qrel]
    description: str | None = None
    relevance_granularity: RelevanceGranularity = RelevanceGranularity.DOCUMENT
