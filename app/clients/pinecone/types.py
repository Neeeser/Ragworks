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


#: Field name pairs for `PineconeUsage`: the OpenAPI schemas spell the
#: counters in camelCase (`Usage.readUnits` on /query and /fetch) while the
#: search-records schema and every Python SDK model spell them snake_case,
#: so both are read rather than assuming which one an SDK version answers
#: with (docs/external-api/pinecone/reference/api/2026-04/data-plane/
#: query.md, fetch.md, search_records.md).
_USAGE_FIELD_NAMES: dict[str, tuple[str, ...]] = {
    "read_units": ("read_units", "readUnits"),
    "embed_total_tokens": ("embed_total_tokens", "embedTotalTokens"),
}


class PineconeUsage(BaseModel):
    """The `usage` block a Pinecone data-plane read returns.

    Query, fetch, list and records-search report `read_units`; the
    integrated-embedding search path additionally reports
    `embed_total_tokens` for the sparse model that embedded the query
    server-side. Write operations (upsert, upsert_records, update, delete)
    return no usage block at all — Pinecone bills write units from request
    size and publishes them only on its usage dashboard.

    A counter the response omits stays `None`: read units are rounded up to
    a whole number by the API, so a real quantity is never zero and a zero
    standing in for "not reported" would understate nothing but claim a
    measurement that was never made.
    """

    read_units: int | None = None
    embed_total_tokens: int | None = None

    @classmethod
    def from_sdk(cls, usage: object) -> PineconeUsage | None:
        """Read an SDK response's `usage` attribute, or None when it has none.

        Total by construction: it runs on the success path of a read that
        already returned, so an unrecognized shape measures nothing rather
        than raising over an answer the caller has in hand.
        """
        if usage is None:
            return None
        values: dict[str, int] = {}
        for field, names in _USAGE_FIELD_NAMES.items():
            for name in names:
                raw = usage.get(name) if isinstance(usage, Mapping) else getattr(usage, name, None)
                if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                    values[field] = int(raw)
                    break
        return cls(**values)


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
