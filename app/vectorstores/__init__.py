"""Vector-store backend subsystem.

One `VectorStoreBackend` interface covers both the control plane (index
admin: list/create/describe/delete) and the data plane (ensure/upsert/query/
delete-namespace) for every supported vector database. Each backend lives in
its own package (`pinecone/`, `pgvector/`) and declares its limits as data
via `VectorStoreCapabilities`; `registry.get_vector_store` is the single
construction point (and the single Pinecone-key enforcement point).
"""

from app.vectorstores.base import (
    IndexSpec,
    VectorIndexDescription,
    VectorStoreBackend,
    VectorStoreCapabilities,
)

__all__ = [
    "IndexSpec",
    "VectorIndexDescription",
    "VectorStoreBackend",
    "VectorStoreCapabilities",
]
