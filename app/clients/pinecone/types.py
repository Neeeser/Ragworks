"""Typed models at the Pinecone client boundary.

These replace the `_as_dict`/`_safe_value` `Any`-typed normalization helpers that used
to live in `app/api/routes/indexes.py`, and the attribute-poking of raw SDK match
objects that used to live in `pinecone_retriever.py`. SDK responses are validated into
these models once, at the client edge (`from_sdk`), instead of being carried as `Any`
through the indexer/retriever/routes layers.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from pydantic import BaseModel, Field

# Pinecone metadata values are restricted to these primitives (see
# docs/external-api/pinecone/guides/search/filter-by-metadata.md); this
# app never writes list-valued metadata, so the narrower primitive union is sufficient
# and catches accidental non-primitive metadata at the client boundary.
PineconeMetadataValue = str | int | float | bool
PineconeMetadata = dict[str, PineconeMetadataValue]


class PineconeVector(BaseModel):
    """A single vector to upsert into a Pinecone index."""

    id: str
    values: list[float]
    metadata: PineconeMetadata = Field(default_factory=dict)


class _ScoredVectorLike(Protocol):
    """Structural shape of the SDK's `ScoredVector`, as returned by `Index.query`."""

    id: str
    score: float
    metadata: Mapping[str, object] | None


class PineconeMatch(BaseModel):
    """A single scored match returned from a Pinecone query."""

    id: str
    score: float
    metadata: PineconeMetadata = Field(default_factory=dict)

    @classmethod
    def from_sdk(cls, match: _ScoredVectorLike) -> PineconeMatch:
        """Validate an SDK `ScoredVector` (or a compatible stub) into a typed match."""
        return cls(id=match.id, score=match.score, metadata=dict(match.metadata or {}))


class PineconeSearchHit(BaseModel):
    """One hit from `Index.search` on an integrated-embedding index.

    The SDK's OpenAPI `Hit` model exposes `_id`/`_score`/`fields` through
    `to_dict()`; record fields (chunk text plus whatever metadata was
    upserted) come back as a plain mapping.
    """

    id: str
    score: float
    fields: dict[str, object] = Field(default_factory=dict)

    @classmethod
    def from_sdk(cls, hit: Mapping[str, object] | _ToDictLike) -> PineconeSearchHit:
        """Validate an SDK `Hit` (or a plain dict, as used in tests)."""
        data = dict(hit) if isinstance(hit, Mapping) else dict(hit.to_dict())
        raw_score = data.get("_score", 0.0)
        raw_fields = data.get("fields")
        return cls(
            id=str(data.get("_id", "")),
            score=float(raw_score) if isinstance(raw_score, int | float) else 0.0,
            fields=dict(raw_fields) if isinstance(raw_fields, Mapping) else {},
        )


class _ToDictLike(Protocol):
    """Structural shape of SDK response models exposing `to_dict()` (e.g. `IndexModel`)."""

    def to_dict(self) -> Mapping[str, object]:
        """Return the model serialized as a plain, JSON-safe dict."""
        ...


class IndexDescription(BaseModel):
    """Typed description of a Pinecone index -- the control-plane `IndexModel` shape.

    Field set mirrors `app.schemas.indexes.IndexRead`, the stable wire schema
    (minus `backend`, which the store layer adds); this is the internal typed
    form `PineconeStore` maps onto `VectorIndexDescription`.
    """

    name: str
    vector_type: str | None = None
    metric: str | None = None
    dimension: int | None = None
    status: dict[str, object] | None = None
    host: str | None = None
    spec: dict[str, object] | None = None
    deletion_protection: str | None = None
    tags: dict[str, str] | None = None
    embed: dict[str, object] | None = None

    @classmethod
    def from_sdk(cls, index: Mapping[str, object] | _ToDictLike) -> IndexDescription:
        """Validate an SDK `IndexModel` (or a plain dict, as used in tests) into a typed model."""
        if isinstance(index, Mapping):
            return cls.model_validate(dict(index))
        return cls.model_validate(dict(index.to_dict()))
