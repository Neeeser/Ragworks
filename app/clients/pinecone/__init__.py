"""Typed Pinecone client package: SDK factory, typed index admin, and shared types."""

from __future__ import annotations

from app.clients.pinecone.client import (
    LEXICAL_TEXT_FIELD,
    SPARSE_TEXT_EMBED_MODEL,
    PineconeIndexAdmin,
    get_pinecone_client,
)
from app.clients.pinecone.types import (
    IndexDescription,
    PineconeMatch,
    PineconeSearchHit,
    PineconeVector,
)

__all__ = [
    "LEXICAL_TEXT_FIELD",
    "SPARSE_TEXT_EMBED_MODEL",
    "IndexDescription",
    "PineconeIndexAdmin",
    "PineconeMatch",
    "PineconeSearchHit",
    "PineconeVector",
    "get_pinecone_client",
]
