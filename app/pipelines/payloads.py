"""Payload models used between pipeline nodes.

The data plane between nodes is the unified `ItemBatch`: an ordered list of
`Item`s that may carry the uploaded file, text, an embedding, and/or a score
(the facets in `app/pipelines/ports.py`). The uploaded file, chunks,
embedded chunks, the query, and retrieval matches are all item batches —
which facets a stream guarantees is what port typing checks. Correlation context (the document being ingested, the query)
lives on `PipelineRunContext`, not in the data plane.

`app/retrieval` and `app/vectorstores` keep their own domain models
(`DocumentChunk`, `ScoredChunk`); nodes convert at that boundary via
`Item.from_chunk`/`to_chunk`/`from_match`/`to_match`.

Terminal nodes emit the result models (`IndexingPayload`,
`RetrievalPayload`) that services extract from terminal outputs — those are
the run's result contract, never an inter-node value.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.pipelines.ports import Facet
from app.pipelines.tracing.summaries import ItemListTrace, ItemRef, TokenUsage
from app.retrieval.models import (
    DocumentChunk,
    DocumentMetadata,
    EmbeddingVector,
    RetrievalResponse,
    ScoredChunk,
)
from app.vectorstores.base import FacetBucket

#: One structured output value: a scalar, or a facet-bucket list (the facet
#: tool's grouped counts). Widening this union is how a new structured value
#: shape joins the tool-result plane — `dump_outputs` must stay in lockstep.
StructuredValue = int | float | str | bool | list[FacetBucket]


def dump_outputs(outputs: Mapping[str, StructuredValue]) -> dict[str, object]:
    """Return a JSON-safe view of structured outputs.

    Scalars pass through; facet buckets dump to plain dicts. Every boundary
    that leaves the typed payload world (the wire response, the query-event
    JSON column, trace summary values) goes through this one function.
    """
    return {
        key: [bucket.model_dump() for bucket in value] if isinstance(value, list) else value
        for key, value in outputs.items()
    }


class TokenizerSpec(BaseModel):
    """Immutable tokenizer selection emitted by tokenizer resource nodes."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["wordpiece", "cl100k", "whitespace", "huggingface"]
    hf_model_id: str | None = None

    @model_validator(mode="after")
    def validate_huggingface_model_id(self) -> TokenizerSpec:
        """Require a model id only for the HuggingFace tokenizer kind."""
        if self.kind == "huggingface" and not self.hf_model_id:
            raise ValueError("A HuggingFace tokenizer requires a model id.")
        if self.kind != "huggingface" and self.hf_model_id is not None:
            raise ValueError("Only a HuggingFace tokenizer accepts a model id.")
        return self


class TextAffixes(BaseModel):
    """What upstream nodes wrapped around an item's own content.

    An annotation, not a facet — nothing requires it and no store or wire
    shape reads it. It exists because the embedding guard has to repeat both
    affixes onto every part when it splits an oversized item: an affix
    surviving only on the first or last part inverts the reason it was
    written, since contextual retrieval situates a chunk precisely so that
    every chunk carries its context. `prepend` and `append` are the same
    problem from two sides, so they are recorded together rather than one
    being treated as the special case.
    """

    model_config = ConfigDict(frozen=True)

    prefix: str = ""
    suffix: str = ""

    @property
    def empty(self) -> bool:
        """True when nothing was written around the content."""
        return not self.prefix and not self.suffix

    def wrap(self, content: str) -> str:
        """Return `content` with both affixes back around it."""
        return f"{self.prefix}{content}{self.suffix}"


class MediaAsset(BaseModel):
    """A reference to stored binary content carried by an item.

    Items are snapshotted into traces and fan out across edges, so the
    bytes themselves never ride on the item — the producing node writes
    them once and consuming nodes read them back when they build a
    provider request. `path` is relative to the configured storage root.
    """

    model_config = ConfigDict(frozen=True)

    media_type: str
    path: str
    byte_size: int = Field(ge=0)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)


#: Reserved metadata key carrying an item's stored image asset through a
#: vector-store row. Namespaced so it can never collide with a document's
#: own metadata (a user key named `image` stays theirs).
IMAGE_ASSET_METADATA_KEY = "ragworks.image_asset"


def _stored_asset(raw: object) -> MediaAsset | None:
    """Rebuild a stored asset reference, treating anything malformed as absent.

    Store metadata survives schema changes and hand edits; a value under the
    reserved key that no longer parses must degrade to a text-only match
    rather than fail the whole retrieval.
    """
    if not isinstance(raw, dict):
        return None
    try:
        return MediaAsset.model_validate(raw)
    except ValidationError:
        return None


class Item(BaseModel):
    """One element of an items stream.

    `id` is the item's stable identity across nodes (chunk ids stay
    `{document_id}:{order}` so vector ids and per-document deletion keep
    working). The optional fields are the facets a stream may guarantee;
    a node that requires a facet raises an honest error when a runtime item
    lacks it (`to_chunk`/`to_match` enforce this at the store boundary).
    """

    id: str
    #: The uploaded file this item stands for, set by `ingestion.input` and
    #: consumed by the parse nodes. A parse node replaces the file item with
    #: what it extracted, so nothing downstream of parsing carries it.
    file: MediaAsset | None = None
    text: str | None = None
    image: MediaAsset | None = None
    embedding: EmbeddingVector | None = None
    score: float | None = None
    document_id: str | None = None
    order: int | None = None
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)
    #: The exact strings upstream nodes wrote around `text` (contextual
    #: retrieval's situating sentence, separators included); `None` once
    #: nothing surrounds the content.
    text_affixes: TextAffixes | None = None

    def facets(self) -> frozenset[str]:
        """Return the facets this item actually carries.

        Runtime partitioning reads presence off the item itself rather
        than trusting an upstream declaration — a node that processes only
        part of a stream leaves items whose facets differ from what the
        port claimed.
        """
        present = {
            Facet.FILE: self.file is not None,
            Facet.TEXT: self.text is not None,
            Facet.IMAGE: self.image is not None,
            Facet.EMBEDDING: self.embedding is not None,
            Facet.SCORE: self.score is not None,
        }
        return frozenset(facet for facet, carried in present.items() if carried)

    def store_text(self) -> str:
        """Return the text a store row records for this item.

        An item with no text of its own but with media attached indexes
        under a derived placeholder: the vector store's text column is not
        nullable and a match has to render as something. The placeholder
        exists only here, at the store boundary — the data plane never
        carries invented text, which is what keeps modality partitioning
        honest upstream.
        """
        if self.text is not None:
            return self.text
        if self.image is None:
            raise ValueError(f"Item '{self.id}' carries no text.")
        name = self.metadata.data.get("filename") or self.id
        page = self.metadata.data.get("page")
        located = f", page {page}" if page is not None else ""
        return f"[image: {name}{located}]"

    @classmethod
    def from_chunk(cls, chunk: DocumentChunk, score: float | None = None) -> Item:
        """Build an item from a retrieval-domain chunk.

        A chunk whose metadata carries an asset reference (an indexed image)
        rebuilds the item's `image`, so a retrieved image match is the same
        shape as the item that produced it.
        """
        return cls(
            id=chunk.chunk_id,
            text=chunk.text,
            image=_stored_asset(chunk.metadata.data.get(IMAGE_ASSET_METADATA_KEY)),
            embedding=chunk.embedding,
            score=score,
            document_id=chunk.document_id,
            order=chunk.order,
            metadata=chunk.metadata,
        )

    @classmethod
    def from_match(cls, match: ScoredChunk) -> Item:
        """Build an item from a scored retrieval match."""
        return cls.from_chunk(match.chunk, score=match.score)

    def to_chunk(self) -> DocumentChunk:
        """Convert to the retrieval-domain chunk shape for store/provider calls."""
        return DocumentChunk(
            document_id=self.document_id or self.id,
            chunk_id=self.id,
            text=self.store_text(),
            order=self.order if self.order is not None else 0,
            metadata=self.store_metadata(),
            embedding=self.embedding,
        )

    def store_metadata(self) -> DocumentMetadata:
        """Return the metadata a store row records, including any asset.

        The asset reference travels in metadata so a retrieval match can
        render the image it stands for; without it a match on an image
        chunk is a placeholder string pointing at nothing.
        """
        if self.image is None:
            return self.metadata
        return DocumentMetadata(
            data={**self.metadata.data, IMAGE_ASSET_METADATA_KEY: self.image.model_dump()}
        )

    def to_match(self) -> ScoredChunk:
        """Convert to a scored match; an unscored item scores 0.0."""
        return ScoredChunk(
            chunk=self.to_chunk(), score=self.score if self.score is not None else 0.0
        )

    def preview_chunk(self) -> DocumentChunk:
        """Lenient chunk view for trace previews — missing text renders empty."""
        return DocumentChunk(
            document_id=self.document_id or self.id,
            chunk_id=self.id,
            text=self.text or "",
            order=self.order if self.order is not None else 0,
            metadata=self.store_metadata(),
            embedding=self.embedding,
        )

    def preview_match(self) -> ScoredChunk:
        """Lenient scored view for trace previews; an unscored item scores 0.0."""
        return ScoredChunk(
            chunk=self.preview_chunk(), score=self.score if self.score is not None else 0.0
        )


class ItemBatch(BaseModel):
    """The unified inter-node value: an ordered list of items.

    `tokenizer` is a batch-level annotation chunkers stamp so the embedding
    guard can count tokens the way the chunks were measured; `usage` is the
    provider token accounting accumulated along this stream (merging nodes
    sum it across branches).
    """

    items: list[Item] = Field(default_factory=list)
    tokenizer: TokenizerSpec | None = None
    usage: TokenUsage = Field(default_factory=TokenUsage)

    @classmethod
    def from_chunks(
        cls,
        chunks: Iterable[DocumentChunk],
        *,
        tokenizer: TokenizerSpec | None = None,
        usage: TokenUsage | None = None,
    ) -> ItemBatch:
        """Build a batch from retrieval-domain chunks."""
        return cls(
            items=[Item.from_chunk(chunk) for chunk in chunks],
            tokenizer=tokenizer,
            usage=usage or TokenUsage(),
        )

    @classmethod
    def from_matches(
        cls,
        matches: Iterable[ScoredChunk],
        *,
        usage: TokenUsage | None = None,
    ) -> ItemBatch:
        """Build a batch from scored retrieval matches."""
        return cls(
            items=[Item.from_match(match) for match in matches],
            usage=usage or TokenUsage(),
        )

    def to_chunks(self) -> list[DocumentChunk]:
        """Convert every item to the retrieval-domain chunk shape."""
        return [item.to_chunk() for item in self.items]

    def to_matches(self) -> list[ScoredChunk]:
        """Convert every item to a scored match."""
        return [item.to_match() for item in self.items]

    def preview_chunks(self) -> list[DocumentChunk]:
        """Lenient chunk views for trace previews (never raises)."""
        return [item.preview_chunk() for item in self.items]

    def preview_matches(self) -> list[ScoredChunk]:
        """Lenient scored views for trace previews (never raises)."""
        return [item.preview_match() for item in self.items]

    def query_text(self) -> str | None:
        """Return the first textual item — the query for single-item streams."""
        return next((item.text for item in self.items if item.text is not None), None)


class IndexingPayload(BaseModel):
    """Terminal result of an ingestion run: the persisted chunk list."""

    chunks: list[DocumentChunk]
    usage: TokenUsage = Field(default_factory=TokenUsage)


class StructuredValuesPayload(BaseModel):
    """Named structured values produced by a structured tool node.

    The `tool.output` terminal merges every inbound values payload into the
    result's `outputs` — for structured tools, these ARE the tool result.
    """

    values: dict[str, StructuredValue] = Field(default_factory=dict)
    usage: TokenUsage = Field(default_factory=TokenUsage)


class RetrievalPayload(BaseModel):
    """Terminal result of a retrieval/tool run.

    `outputs` carries the extra named values the terminal node evaluated
    from its declared output expressions; empty for pipelines that declare
    none.
    """

    response: RetrievalResponse
    usage: TokenUsage = Field(default_factory=TokenUsage)
    outputs: dict[str, StructuredValue] = Field(default_factory=dict)


def batch_kind(items: Sequence[Item]) -> Literal["chunks", "matches"]:
    """Classify a stream for trace item lists: scored items trace as matches."""
    return "matches" if any(item.score is not None for item in items) else "chunks"


def trace_items(items: Sequence[Item]) -> ItemListTrace:
    """Preserve every item id (and score, for scored streams) in order."""
    kind = batch_kind(items)
    return ItemListTrace(
        kind=kind,
        items=[
            ItemRef(id=item.id, score=item.score if kind == "matches" else None) for item in items
        ],
    )
