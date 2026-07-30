"""Deprecated backend-pinned indexer nodes.

Kept registered because node type ids are permanent -- persisted pipeline
versions may still reference them -- but hidden from the editor catalog.
New pipelines use the unified `indexer.vector` (`app/pipelines/nodes/indexing.py`);
the startup migration in `app/pipelines/upgrades.py` rewrites these ids.
"""

from __future__ import annotations

from typing import ClassVar

from app.pipelines.nodes.indexing import BaseIndexerNode, PgvectorIndexerConfig
from app.schemas.enums import IndexBackend


class IndexerNode(BaseIndexerNode):
    """Deprecated Pinecone-pinned indexer; new pipelines use `indexer.vector`."""

    backend: ClassVar[IndexBackend] = IndexBackend.PINECONE
    type = "indexer.pinecone"
    label = "Pinecone Indexer"
    description = "Upsert embeddings into Pinecone."
    example = "Items(2 embedded) -> Items(2 embedded, indexed into 'pinecone')."
    hidden = True


class PgvectorIndexerNode(BaseIndexerNode):
    """Deprecated pgvector-pinned indexer; new pipelines use `indexer.vector`."""

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    type = "indexer.pgvector"
    label = "pgvector Indexer"
    description = "Upsert embeddings into the built-in Postgres (pgvector)."
    example = "Items(2 embedded) -> Items(2 embedded, indexed into 'pgvector')."
    config_model = PgvectorIndexerConfig
    hidden = True
