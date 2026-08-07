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

#: Metadata key naming the `EvalModality` a record was built from. Generation
#: stamps it on every corpus document and query it writes.
MODALITY_METADATA_KEY = "modality"


def _require_content(label: str, text: str | None, media: MediaAsset | None) -> None:
    """Reject a record carrying neither text nor media.

    Such a record is unevaluatable — nothing can be indexed for it and nothing
    can be asked with it — and it reaches the run engine as a silently empty
    document or query rather than as a rejected import.
    """
    if text is None and media is None:
        raise InvalidInputError(f"{label} carries neither text nor media.")


def _record_modalities(record: CorpusDoc | QueryRecord) -> set[str]:
    """Return the modalities one record carries.

    Text is read off the record; media is classified by `_media_modality`.
    The `modality` stamp reaches only that second question — a synthetic
    query written from a page image is stamped `image` and carries text
    alone, so letting the stamp speak for the whole record would badge a
    text question set as images.
    """
    modalities: set[str] = set()
    if record.text is not None:
        modalities.add(EvalModality.TEXT.value)
    if record.media is not None:
        media_modality = _media_modality(record.metadata, record.media)
        if media_modality is not None:
            modalities.add(media_modality)
    return modalities


def _media_modality(metadata: dict[str, object], media: MediaAsset) -> str | None:
    """Classify a record's media, preferring an explicit modality stamp.

    Stored bytes are often the original upload, whose content type names a
    container rather than a modality: a page-image PDF is `application/pdf`,
    so classifying by content type alone reports an image corpus as text.
    A stamp outside `EvalModality` is ignored — that enum is the vocabulary
    the catalog and the run wizard render, so a value invented here reaches
    surfaces that cannot show it.
    """
    stamp = metadata.get(MODALITY_METADATA_KEY)
    if isinstance(stamp, str):
        try:
            return EvalModality(stamp).value
        except ValueError:
            pass  # the content type is the remaining statement about the bytes
    return EvalModality.IMAGE.value if is_image_content_type(media.media_type) else None


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
            modalities |= _record_modalities(record)
        object.__setattr__(self, "modalities", frozenset(modalities))
