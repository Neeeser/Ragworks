"""Shared stub factories for pipeline node/execution tests.

`OpenRouterEmbedder` gets monkeypatched out in several node tests with
slightly different canned results; vector-store access goes through the run
context, so `StubVectorStore`/`StubVectorStoreProvider` stand in for a real
backend without any monkeypatching.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, ClassVar

from app.retrieval.models import DocumentChunk, RetrievalResponse, ScoredChunk
from app.schemas.enums import IndexBackend
from app.vectorstores.base import (
    IndexSpec,
    VectorIndexDescription,
    VectorStoreBackend,
    VectorStoreCapabilities,
)


def make_stub_embedder(
    *,
    usage: dict[str, int] | None = None,
    documents_result: list[list[float]] | None = None,
    query_result: list[float] | None = None,
) -> type:
    """Build a stand-in class for OpenRouterEmbedder with canned results.

    `documents_result`/`query_result` default to a fixed two-value vector per
    input when not given, matching the placeholder embeddings the original
    per-test stubs used.
    """

    class _StubEmbedder:
        def __init__(
            self,
            _client: object,
            _model_name: str,
            *,
            dimensions: int | None = None,
        ) -> None:
            self.usage = usage or {}

        def embed_documents(self, chunks: list[object]) -> list[list[float]]:
            if documents_result is not None:
                return documents_result
            return [[0.1, 0.2] for _ in chunks]

        def embed_query(self, _query: str) -> list[float]:
            if query_result is not None:
                return query_result
            return [0.1, 0.2]

    return _StubEmbedder


class StubVectorStore(VectorStoreBackend):
    """Recording in-memory `VectorStoreBackend` for node/execution tests."""

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    capabilities: ClassVar[VectorStoreCapabilities] = VectorStoreCapabilities(
        max_dimension=2000,
        supported_metrics=("cosine", "l2", "dotproduct"),
        requires_api_key=False,
    )

    def __init__(self, query_matches: list[ScoredChunk] | None = None) -> None:
        self.query_matches = query_matches or []
        self.ensure_calls: list[IndexSpec] = []
        self.upsert_calls: list[dict[str, Any]] = []
        self.query_calls: list[dict[str, Any]] = []
        self.deleted_namespaces: list[tuple[str, str]] = []
        self.deleted_documents: list[tuple[str, str, str]] = []

    def list_indexes(self) -> list[VectorIndexDescription]:
        return []

    def describe_index(self, name: str) -> VectorIndexDescription:
        return VectorIndexDescription(name=name, backend=self.backend)

    def create_index(self, spec: IndexSpec) -> VectorIndexDescription:
        self.ensure_calls.append(spec)
        return VectorIndexDescription(name=spec.name, backend=self.backend)

    def delete_index(self, name: str) -> None:  # pragma: no cover - unused in tests
        del name

    def ensure_index(self, spec: IndexSpec) -> None:
        self.ensure_calls.append(spec)

    def upsert(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        self.upsert_calls.append(
            {"index": index, "namespace": namespace, "chunks": list(chunks)}
        )

    def query(
        self,
        index: str,
        namespace: str,
        *,
        embedding: Sequence[float],
        top_k: int,
        filter: dict[str, Any] | None = None,
    ) -> RetrievalResponse:
        self.query_calls.append(
            {
                "index": index,
                "namespace": namespace,
                "embedding": list(embedding),
                "top_k": top_k,
                "filter": filter,
            }
        )
        return RetrievalResponse(matches=list(self.query_matches))

    def delete_namespace(self, index: str, namespace: str) -> None:
        self.deleted_namespaces.append((index, namespace))

    def delete_document_vectors(self, index: str, namespace: str, document_id: str) -> None:
        self.deleted_documents.append((index, namespace, document_id))


class StubVectorStoreProvider:
    """Stands in for `VectorStoreProvider`: one shared store for any backend."""

    def __init__(self, store: StubVectorStore | None = None) -> None:
        self.store = store or StubVectorStore()
        self.requested_backends: list[IndexBackend] = []

    def get(self, backend: IndexBackend) -> StubVectorStore:
        self.requested_backends.append(backend)
        return self.store
