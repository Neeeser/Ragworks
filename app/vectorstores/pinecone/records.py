"""Shaping Pinecone records into retrieval-domain chunks.

Pure conversion, no I/O: the store owns the SDK calls and hands what came
back to these functions. Pinecone carries a chunk's text, document id, and
order as ordinary metadata keys alongside the document's own metadata, so
every read path has to lift the same three reserved keys back out — and a
path that forgets one returns a chunk whose document is its chunk id, or
whose order is zero. Keeping the lift in one place is what stops the dense,
lexical, and lineage reads from disagreeing about it.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.clients.pinecone import (
    LEXICAL_TEXT_FIELD,
    PineconeMatch,
    PineconeSearchHit,
)
from app.retrieval.models import DocumentChunk, DocumentMetadata, ScoredChunk

#: The metadata key chunk text is stored under in Pinecone records.
TEXT_METADATA_KEY = "text"

#: The reserved keys a record carries beside the document's own metadata.
_DOCUMENT_ID_KEY = "document_id"
_ORDER_KEY = "order"


def _order_of(value: object) -> int:
    """Read a stored order, defaulting to 0 for anything non-numeric.

    Store metadata survives schema changes and hand edits, so a value that
    is not a number is treated as an unordered chunk rather than failing the
    read that found it.
    """
    return int(value) if isinstance(value, int | float) else 0


def chunk_from_metadata(
    chunk_id: str, metadata: dict[str, Any], *, text_key: str = TEXT_METADATA_KEY
) -> DocumentChunk:
    """Build a chunk from one record's id and metadata, lifting the reserved keys."""
    fields = dict(metadata)
    text = fields.pop(text_key, "")
    document_id = fields.pop(_DOCUMENT_ID_KEY, chunk_id)
    order = fields.pop(_ORDER_KEY, 0)
    return DocumentChunk(
        document_id=str(document_id),
        chunk_id=chunk_id,
        text=str(text),
        order=_order_of(order),
        metadata=DocumentMetadata(data=fields),
    )


def scored_chunks(matches: Sequence[PineconeMatch]) -> list[ScoredChunk]:
    """Convert typed dense matches into scored chunks."""
    return [
        ScoredChunk(chunk=chunk_from_metadata(match.id, dict(match.metadata)), score=match.score)
        for match in matches
    ]


def scored_chunk_from_hit(hit: PineconeSearchHit) -> ScoredChunk:
    """Convert one typed lexical search hit into a scored chunk.

    A search hit's fields are provider-shaped, so non-scalar values are
    dropped rather than carried into `DocumentMetadata`.
    """
    fields = {
        key: value
        for key, value in hit.fields.items()
        if isinstance(value, str | int | float | bool)
        or key in {LEXICAL_TEXT_FIELD, _DOCUMENT_ID_KEY, _ORDER_KEY}
    }
    return ScoredChunk(
        chunk=chunk_from_metadata(hit.id, fields, text_key=LEXICAL_TEXT_FIELD),
        score=hit.score,
    )


def chunk_from_vector(vector_id: str, vector: Any) -> DocumentChunk:
    """Convert one fetched vector into a chunk.

    The SDK's fetch response is a mapping of id to vector object; only its
    metadata is read here, so a vector without any is an empty chunk rather
    than an attribute error.
    """
    return chunk_from_metadata(vector_id, dict(getattr(vector, "metadata", None) or {}))
