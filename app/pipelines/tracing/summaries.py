"""Typed trace summary models, replacing `nodes/trace_utils.py`'s dict returns.

`NodeTraceValue.value` (see `recorder.py`) stays typed `object` -- FastAPI's
`jsonable_encoder` (which `serialize_payload` wraps) serializes a Pydantic
model dropped into an `object`/`Any`-typed field the same way it would a
concretely-typed one, recursing through nested models and lists correctly.
That means these models are drop-in replacements for the old dict-returning
helpers: same function names and signatures, only the return type moves from
`dict[str, object]` to a typed model.

Several of the old dict shapes omitted a key conditionally (`summarize_text`'s
`full`, `summarize_chunks`'s `document_id`) rather than including it with a
`null` value. Pydantic's default `model_dump` can only do that uniformly via
the caller's `exclude_none` flag, which `serialize_payload` does not set (and
must not start setting, since other fields -- `EmbeddingSummary.dimension`,
`EmbeddingSample.preview` -- rely on `null` staying present). So the few
models with a conditionally-omitted field define their own `@model_serializer`
to pin the exact shape regardless of caller flags; the rest use the default
dump. `tests/pipelines/test_tracing.py` asserts byte-for-byte parity with the
pre-refactor dict output for representative inputs of every summarizer here --
the frontend reads these blobs directly, so this is a wire contract, not an
implementation detail.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, Field, model_serializer

from app.retrieval.models import DocumentChunk, ScoredChunk
from app.retrieval.parsers.base import DocumentSource


class ItemRef(BaseModel):
    """One result in an ordered trace list, identified without payload text."""

    id: str
    score: float | None = None


class ItemListTrace(BaseModel):
    """Complete ordered identities for one item-capable node port.

    This is the traceability extension boundary. Item-producing nodes attach
    this model alongside their human-readable previews; consumers derive node
    effects from the complete lists, so this data must never be truncated.
    """

    kind: Literal["chunks", "matches"]
    items: list[ItemRef]


class RankingSourceEvidence(BaseModel):
    """One ranking input's facts for one output result.

    `source_index` maps to the node's ordered inbound edges. Labels and node
    identity stay in the pipeline definition; the evidence records only the
    domain facts a visualization needs.
    """

    source_index: int
    rank: int | None = None
    score: float | None = None
    score_label: str | None = None
    weight: float | None = None
    contribution: float | None = None


class RankingResultEvidence(BaseModel):
    """One result in a ranking node's output plus its per-source evidence."""

    id: str
    rank: int
    score: float | None = None
    sources: list[RankingSourceEvidence] = Field(default_factory=list)


class RankingEvidence(BaseModel):
    """Method-neutral ranking facts rendered by the trace debugger.

    New retrievers and ranking nodes can emit this contract without adding a
    node-type branch to the debugger. Optional fields disappear naturally
    when a method has no score, formula, or decomposable contribution.
    """

    method: str
    score_label: str | None = None
    formula: str | None = None
    results: list[RankingResultEvidence]


def trace_chunk_items(chunks: Sequence[DocumentChunk]) -> ItemListTrace:
    """Preserve every chunk id in its node-local order."""
    return ItemListTrace(
        kind="chunks",
        items=[ItemRef(id=chunk.chunk_id) for chunk in chunks],
    )


def trace_match_items(matches: Sequence[ScoredChunk]) -> ItemListTrace:
    """Preserve every match id and score in its node-local order."""
    return ItemListTrace(
        kind="matches",
        items=[ItemRef(id=match.chunk.chunk_id, score=match.score) for match in matches],
    )


class TokenUsage(BaseModel):
    """Token accounting for an embedding call.

    Mirrors the two fields OpenRouter's embeddings usage payload populates.
    Unset fields are omitted on serialization so an empty usage payload still
    serializes to `{}`, matching the `dict[str, int]` it replaces at the
    `app/pipelines/payloads.py` boundary.
    """

    prompt_tokens: int | None = None
    total_tokens: int | None = None

    @model_serializer
    def _serialize(self) -> dict[str, int]:
        data: dict[str, int] = {}
        if self.prompt_tokens is not None:
            data["prompt_tokens"] = self.prompt_tokens
        if self.total_tokens is not None:
            data["total_tokens"] = self.total_tokens
        return data


def combine_usage(usages: Sequence[TokenUsage]) -> TokenUsage:
    """Sum token usage across parallel pipeline branches.

    A field stays `None` (omitted on serialization) only when no branch
    reported it, so an all-lexical run still serializes usage as `{}`.
    """
    combined = TokenUsage()
    for usage in usages:
        if usage.prompt_tokens is not None:
            combined.prompt_tokens = (combined.prompt_tokens or 0) + usage.prompt_tokens
        if usage.total_tokens is not None:
            combined.total_tokens = (combined.total_tokens or 0) + usage.total_tokens
    return combined


def preview_text(text: str, limit: int = 240) -> str:
    """Return a truncated preview of text."""
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


class SourceSummary(BaseModel):
    """Summary of a document source payload."""

    document_id: str
    path: str
    content_type: str | None


def summarize_source(source: DocumentSource) -> SourceSummary:
    """Summarize a document source payload."""
    display_path = source.metadata.data.get("path")
    return SourceSummary(
        document_id=source.document_id,
        path=display_path if isinstance(display_path, str) else str(source.path),
        content_type=source.content_type,
    )


class TextSummary(BaseModel):
    """Summary of text content with a preview and optional full text."""

    preview: str
    length: int
    full: str | None = None

    @model_serializer
    def _serialize(self) -> dict[str, object]:
        data: dict[str, object] = {"preview": self.preview, "length": self.length}
        if self.full is not None:
            data["full"] = self.full
        return data


def summarize_text(text: str, limit: int = 240, full_limit: int = 2000) -> TextSummary:
    """Summarize text content with a preview and optional full text."""
    return TextSummary(
        preview=preview_text(text, limit),
        length=len(text),
        full=text if len(text) <= full_limit else None,
    )


class ChunkSample(BaseModel):
    """One chunk's preview within a ChunkBatchSummary."""

    chunk_id: str
    order: int
    preview: str


class ChunkBatchSummary(BaseModel):
    """Summary of a batch of document chunks."""

    count: int
    samples: list[ChunkSample]
    document_id: str | None = None

    @model_serializer
    def _serialize(self) -> dict[str, object]:
        data: dict[str, object] = {
            "count": self.count,
            "samples": [sample.model_dump() for sample in self.samples],
        }
        if self.document_id is not None:
            data["document_id"] = self.document_id
        return data


def summarize_chunks(chunks: Sequence[DocumentChunk], limit: int = 3) -> ChunkBatchSummary:
    """Summarize a batch of document chunks."""
    samples = [
        ChunkSample(
            chunk_id=chunk.chunk_id,
            order=chunk.order,
            preview=preview_text(chunk.text, 160),
        )
        for chunk in chunks[:limit]
    ]
    return ChunkBatchSummary(
        count=len(chunks),
        samples=samples,
        document_id=chunks[0].document_id if chunks else None,
    )


class EmbeddingPreview(BaseModel):
    """A value slice of an embedding vector plus its total length."""

    preview: list[float]
    total_values: int


def _embedding_preview(embedding: Sequence[float] | None, limit: int = 12) -> EmbeddingPreview | None:
    """Return a preview for an embedding vector."""
    if embedding is None:
        return None
    return EmbeddingPreview(preview=list(embedding[:limit]), total_values=len(embedding))


class EmbeddingSample(BaseModel):
    """One chunk's embedding preview within an EmbeddingSummary."""

    chunk_id: str
    preview: EmbeddingPreview | None


class EmbeddingSummary(BaseModel):
    """Summary of embeddings attached to a batch of chunks."""

    count: int
    dimension: int | None
    samples: list[EmbeddingSample]


def summarize_embeddings(chunks: Sequence[DocumentChunk], limit: int = 2) -> EmbeddingSummary:
    """Summarize embeddings attached to chunks."""
    dimension: int | None = None
    samples: list[EmbeddingSample] = []
    for chunk in chunks[:limit]:
        preview = _embedding_preview(chunk.embedding)
        if dimension is None and chunk.embedding is not None:
            dimension = len(chunk.embedding)
        samples.append(EmbeddingSample(chunk_id=chunk.chunk_id, preview=preview))
    return EmbeddingSummary(count=len(chunks), dimension=dimension, samples=samples)


def summarize_query_embedding(embedding: Sequence[float] | None) -> EmbeddingPreview:
    """Summarize a query embedding vector."""
    return _embedding_preview(embedding) or EmbeddingPreview(preview=[], total_values=0)


class MatchEntry(BaseModel):
    """One scored chunk within a MatchListSummary."""

    rank: int
    chunk_id: str
    document_id: str
    score: float
    preview: str


class MatchListSummary(BaseModel):
    """Summary of retrieval matches with scores and previews."""

    count: int
    top_matches: list[MatchEntry]


def summarize_matches(matches: Sequence[ScoredChunk], limit: int = 5) -> MatchListSummary:
    """Summarize retrieval matches with scores and previews."""
    top_matches = [
        MatchEntry(
            rank=index,
            chunk_id=match.chunk.chunk_id,
            document_id=match.chunk.document_id,
            score=match.score,
            preview=preview_text(match.chunk.text, 160),
        )
        for index, match in enumerate(matches[:limit], start=1)
    ]
    return MatchListSummary(count=len(matches), top_matches=top_matches)


class MatchOrderEntry(BaseModel):
    """One match's rank and score within a match-order comparison."""

    rank: int
    chunk_id: str
    score: float


def summarize_match_order(matches: Sequence[ScoredChunk], limit: int = 8) -> list[MatchOrderEntry]:
    """Summarize match order for reranking comparisons."""
    return [
        MatchOrderEntry(rank=index, chunk_id=match.chunk.chunk_id, score=match.score)
        for index, match in enumerate(matches[:limit], start=1)
    ]
