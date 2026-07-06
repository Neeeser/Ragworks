"""Pinecone-based indexer implementation."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from pinecone import Pinecone, ServerlessSpec  # pylint: disable=no-name-in-module

from app.clients.pinecone import PineconeVector, get_pinecone_client

from ..models import DocumentChunk
from .base import Indexer, VectorIndexConfig


class PineconeIndexConfig(VectorIndexConfig):
    """Pinecone-specific index configuration."""

    dimension: int = 384
    metric: str = "cosine"
    cloud: str = "aws"
    region: str = "us-east-1"
    text_key: str = "text"
    deletion_protection: str = "disabled"
    serverless_spec: dict[str, Any] | None = None


class PineconeIndexer(Indexer):
    """Indexer implementation backed by Pinecone."""

    def __init__(
        self,
        client: Pinecone | None = None,
        api_key: str | None = None,
    ) -> None:
        """Initialize the Pinecone client wrapper.

        Uses `client` as-is when provided (test injection); otherwise resolves a
        fresh client from `api_key` via `app.clients.pinecone.get_pinecone_client`.
        """
        self._client = client if client is not None else get_pinecone_client(api_key or "")
        self._indexes: dict[str, Any] = {}

    def ensure_index(self, config: PineconeIndexConfig) -> None:  # type: ignore[override]
        """Create the Pinecone index if it does not already exist.

        Note: `Indexer.ensure_index` is typed against the base `VectorIndexConfig`;
        every concrete indexer today narrows to its own config subtype. Making
        `Indexer` generic over the config type would fix this properly -- left
        as-is since PineconeIndexer is currently the only implementation.
        """
        if self._client.has_index(config.name):
            return

        spec_kwargs = config.serverless_spec or {}
        spec_kwargs.setdefault("cloud", config.cloud)
        spec_kwargs.setdefault("region", config.region)
        spec = ServerlessSpec(**spec_kwargs)

        self._client.create_index(
            name=config.name,
            dimension=config.dimension,
            metric=config.metric,
            spec=spec,
            deletion_protection=config.deletion_protection,
        )

    def upsert(  # type: ignore[override]
        self,
        config: PineconeIndexConfig,
        chunks: Sequence[DocumentChunk],
        namespace: str | None = None,
    ) -> None:
        """Upsert chunk vectors into Pinecone.

        Note: see `ensure_index` above -- same base-config narrowing.
        """
        if not chunks:
            return

        namespace = namespace or config.namespace
        index = self._get_index(config.name)

        vectors: list[PineconeVector] = []
        for chunk in chunks:
            if chunk.embedding is None:
                raise ValueError(f"Chunk {chunk.chunk_id} missing embedding.")
            metadata: dict[str, Any] = dict(chunk.metadata.data)
            metadata["document_id"] = chunk.document_id
            metadata["order"] = chunk.order
            metadata[config.text_key] = chunk.text
            vectors.append(
                PineconeVector(id=chunk.chunk_id, values=list(chunk.embedding), metadata=metadata)
            )

        # Serialize at the SDK call boundary: `Index.upsert` accepts plain
        # id/values/metadata dicts (`VectorTypedDict`).
        index.upsert(
            vectors=[vector.model_dump() for vector in vectors],
            namespace=namespace,
        )

    def delete_index(self, name: str) -> None:
        """Delete an index by name and evict cached handles."""
        if self._client.has_index(name):
            self._client.delete_index(name)
        self._indexes.pop(name, None)

    def _get_index(self, name: str) -> Any:
        """Return a cached index handle."""
        if name not in self._indexes:
            self._indexes[name] = self._client.Index(name)
        return self._indexes[name]
