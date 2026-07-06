"""Typed Pinecone client package: SDK factory, typed index admin, and shared types."""

from __future__ import annotations

from app.clients.pinecone.client import PineconeIndexAdmin, get_pinecone_client
from app.clients.pinecone.types import IndexDescription, PineconeMatch, PineconeVector

__all__ = [
    "IndexDescription",
    "PineconeIndexAdmin",
    "PineconeMatch",
    "PineconeVector",
    "get_pinecone_client",
]
