"""Shared helpers for Pinecone client initialization."""

from __future__ import annotations

from typing import Optional

from pinecone import Pinecone


def get_pinecone_client(
    client: Optional[Pinecone] = None,
    api_key: Optional[str] = None,
) -> Pinecone:
    """Return a configured Pinecone client instance."""
    if client is None:
        resolved_api_key = (api_key or "").strip()
        if not resolved_api_key:
            raise ValueError("Pinecone API key must be provided.")
        client = Pinecone(api_key=resolved_api_key)
    return client
