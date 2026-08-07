"""The dataset abstraction shared by every eval dataset source.

A dataset is the BEIR triple — corpus, queries, and relevance judgments (qrels).
A curated benchmark, a user's uploaded dataset, and a future synthetic
generator all resolve to the same `DatasetTriple`, so the run engine consumes one
shape regardless of where the data came from.

Media is a property of a record rather than a kind of dataset: a text corpus, a
page-image benchmark, and a dataset mixing the two are all the same triple, and
what a record carries is what decides the dataset's modalities.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from app.pipelines.payloads import MediaAsset
from app.schemas.content_types import is_image_content_type
from app.schemas.enums import EvalModality, RelevanceGranularity
from app.services.errors import InvalidInputError


def _require_content(label: str, text: str | None, media: MediaAsset | None) -> None:
    """Reject a record carrying neither text nor media.

    Such a record is unevaluatable — nothing can be indexed for it and nothing
    can be asked with it — and it reaches the run engine as a silently empty
    document or query rather than as a rejected import.
    """
    if text is None and media is None:
        raise InvalidInputError(f"{label} carries neither text nor media.")


def _record_modalities(text: str | None, media: MediaAsset | None) -> set[str]:
    """Return the modalities one record carries.

    Media outside `EvalModality` contributes none: that enum is the vocabulary
    the catalog and the run wizard render, so a third value invented here
    reaches surfaces that cannot show it.
    """
    modalities: set[str] = set()
    if text is not None:
        modalities.add(EvalModality.TEXT.value)
    if media is not None and is_image_content_type(media.media_type):
        modalities.add(EvalModality.IMAGE.value)
    return modalities


@dataclass(frozen=True)
class CorpusDoc:
    """One corpus document, keyed by its dataset-native external id.

    Carries text, media, or both — a page image may ship beside an OCR-ish
    summary, and both are worth keeping.
    """

    external_doc_id: str
    text: str | None = None
    title: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)
    media: MediaAsset | None = None

    def __post_init__(self) -> None:
        """Reject a document carrying neither text nor media."""
        _require_content(f"Corpus document '{self.external_doc_id}'", self.text, self.media)


@dataclass(frozen=True)
class QueryRecord:
    """One query, keyed by its dataset-native external id.

    `metadata` is populated by synthetic generation (question type, critique
    scores, source chunk ids); benchmark and uploaded queries leave it empty.
    An image query carries `media` and may carry no text at all.
    """

    external_query_id: str
    text: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)
    media: MediaAsset | None = None

    def __post_init__(self) -> None:
        """Reject a query carrying neither text nor media."""
        _require_content(f"Query '{self.external_query_id}'", self.text, self.media)


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
    #: Derived from the records, never supplied: a caller's claim about what
    #: a corpus holds is what the persistence layer would then have to
    #: re-check, and the records are the only honest answer.
    modalities: frozenset[str] = field(init=False)

    def __post_init__(self) -> None:
        """Derive `modalities` from what the records actually carry."""
        records: Iterable[CorpusDoc | QueryRecord] = (*self.corpus, *self.queries)
        modalities: set[str] = set()
        for record in records:
            modalities |= _record_modalities(record.text, record.media)
        object.__setattr__(self, "modalities", frozenset(modalities))
