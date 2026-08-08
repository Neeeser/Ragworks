"""Shared stub factories for pipeline node/execution tests.

Embedders are served through the run context's provider resolver, so
`StubProviderResolver` (with `make_stub_embedder` classes) stands in for the
provider layer, and `StubVectorStore`/`StubVectorStoreProvider` stand in for a
real vector backend — no monkeypatching required.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, ClassVar

from app.providers.throttle import RetryPolicy
from app.retrieval.models import DocumentChunk, RetrievalResponse, ScoredChunk
from app.schemas.enums import IndexBackend
from app.vectorstores.base import (
    FacetBucket,
    IndexSpec,
    IndexStats,
    LexicalCountResult,
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

    def __init__(
        self,
        query_matches: list[ScoredChunk] | None = None,
        lexical_matches: list[ScoredChunk] | None = None,
    ) -> None:
        self.query_matches = query_matches or []
        self.lexical_matches = lexical_matches or []
        self.query_error: Exception | None = None
        self.lexical_query_error: Exception | None = None
        self.lexical_count_result: LexicalCountResult = LexicalCountResult(
            matching_documents=0, matching_chunks=0
        )
        self.lexical_count_error: Exception | None = None
        self.lexical_count_calls: list[dict[str, Any]] = []
        self.lexical_facet_result: list[FacetBucket] = []
        self.lexical_facet_error: Exception | None = None
        self.lexical_facet_calls: list[dict[str, Any]] = []
        self.ensure_calls: list[IndexSpec] = []
        self.upsert_calls: list[dict[str, Any]] = []
        self.upsert_lexical_calls: list[dict[str, Any]] = []
        self.query_calls: list[dict[str, Any]] = []
        self.lexical_query_calls: list[dict[str, Any]] = []
        self.deleted_namespaces: list[tuple[str, str]] = []
        self.deleted_documents: list[tuple[str, str, str]] = []
        #: Stored chunk lineage keyed by document id, as the store would
        #: return it (chunk order ascending) — what Expand Context reads.
        self.document_chunks: dict[str, list[DocumentChunk]] = {}
        self.fetch_document_calls: list[dict[str, Any]] = []
        self.fetch_document_error: Exception | None = None

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
        if self.query_error is not None:
            raise self.query_error
        return RetrievalResponse(matches=list(self.query_matches))

    def fetch_document_chunks(
        self, index: str, namespace: str, document_id: str, *, limit: int
    ) -> list[DocumentChunk]:
        self.fetch_document_calls.append(
            {"index": index, "namespace": namespace, "document_id": document_id, "limit": limit}
        )
        if self.fetch_document_error is not None:
            raise self.fetch_document_error
        return list(self.document_chunks.get(document_id, []))[:limit]

    def upsert_lexical(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        self.upsert_lexical_calls.append(
            {"index": index, "namespace": namespace, "chunks": list(chunks)}
        )

    def lexical_query(
        self,
        index: str,
        namespace: str,
        *,
        text: str,
        top_k: int,
        filter: dict[str, Any] | None = None,
    ) -> RetrievalResponse:
        self.lexical_query_calls.append(
            {
                "index": index,
                "namespace": namespace,
                "text": text,
                "top_k": top_k,
                "filter": filter,
            }
        )
        if self.lexical_query_error is not None:
            raise self.lexical_query_error
        return RetrievalResponse(matches=list(self.lexical_matches))

    def lexical_count(self, index: str, namespace: str, *, text: str) -> LexicalCountResult:
        self.lexical_count_calls.append({"index": index, "namespace": namespace, "text": text})
        if self.lexical_count_error is not None:
            raise self.lexical_count_error
        return self.lexical_count_result

    def lexical_facet(
        self,
        index: str,
        namespace: str,
        *,
        text: str,
        field: str,
        top_n: int = 10,
    ) -> list[FacetBucket]:
        self.lexical_facet_calls.append(
            {"index": index, "namespace": namespace, "text": text, "field": field, "top_n": top_n}
        )
        if self.lexical_facet_error is not None:
            raise self.lexical_facet_error
        return list(self.lexical_facet_result)

    def delete_namespace(self, index: str, namespace: str) -> None:
        self.deleted_namespaces.append((index, namespace))

    def delete_document_vectors(self, index: str, namespace: str, document_id: str) -> None:
        self.deleted_documents.append((index, namespace, document_id))

    def index_stats(self, index: str, namespace: str | None = None) -> IndexStats:
        del index, namespace
        return IndexStats(exists=True, count=len(self.query_matches))


class StubChatProvider:
    """Canned `ChatProvider`: replays queued responses and records requests.

    Each queued entry is either a message dict (returned as the assistant
    message) or an exception instance (raised by `chat`). `usage` rides
    along on every successful response.

    `responses` binds an answer to *arrival* order, which is only meaningful
    while the calls are sequential — retries of one call, or a batch of one
    item. `LlmEngine` dispatches a multi-item batch through a thread pool, so
    which call reaches the queue first is a race: a test queueing one answer
    per item pairs them correctly only by luck. Such a test passes
    `responder` instead and answers from the request, which is also what
    makes it able to fail if the engine ever stopped pairing outcome *i* with
    call *i*.
    """

    name = "stub"

    def __init__(
        self,
        responses: list[Any] | None = None,
        *,
        model_info: Any = None,
        usage: dict[str, int] | None = None,
        responder: Callable[[Any], Any] | None = None,
    ) -> None:
        self.responses = list(responses or [])
        self.model_info = model_info
        self.usage = usage or {"prompt_tokens": 10, "completion_tokens": 5}
        self.requests: list[Any] = []
        self._responder = responder

    def get_model(self, _model_id: str) -> Any:
        return self.model_info

    def chat(self, request: Any) -> dict[str, Any]:
        self.requests.append(request)
        entry = self._responder(request) if self._responder else self._next_queued()
        if isinstance(entry, Exception):
            raise entry
        return {"message": entry, "usage": dict(self.usage)}

    def _next_queued(self) -> Any:
        if not self.responses:
            raise AssertionError("StubChatProvider ran out of queued responses.")
        return self.responses.pop(0)

    def chat_stream(self, request: Any) -> Any:
        raise NotImplementedError

    def parse_chat_response(self, response: dict[str, Any]) -> Any:
        from app.providers.chat.base import ParsedChatResponse

        return ParsedChatResponse(
            message=response["message"],
            usage=response["usage"],
            provider="stub",
            response_model=None,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> Any:
        raise NotImplementedError


class StubProviderResolver:
    """Stands in for `ProviderResolver`: serves `embedder_cls` for any connection.

    Tests swap `embedder_cls` (built via `make_stub_embedder`) after building
    the run context — the resolver is the run's real embedder boundary. LLM
    nodes read `chat_provider` and `chat_concurrency` the same way.
    """

    def __init__(
        self,
        embedder_cls: type | None = None,
        *,
        embedding_input_limit: int | None = None,
        chat_provider: StubChatProvider | None = None,
        chat_concurrency: int = 2,
        retry_policy: RetryPolicy | None = None,
        published_modalities: frozenset[str] | None = None,
    ) -> None:
        self.embedder_cls = embedder_cls or make_stub_embedder()
        self.published_embedding_input_limit = embedding_input_limit
        #: What a model's catalog publishes about its input modalities;
        #: empty (the default) means the provider states nothing, which is
        #: how most real catalogs answer.
        self.published_modalities = published_modalities or frozenset()
        self.chat_provider = chat_provider or StubChatProvider()
        self.chat_concurrency = chat_concurrency
        #: Mirrors `ProviderResolver.retry_policy` — `LlmEngine` reads this
        #: once at construction. Tests that care about attempt counts pass
        #: their own `RetryPolicy`; everything else gets the real default.
        self.retry_policy = retry_policy or RetryPolicy()

    def embedder(self, _connection_id: Any, model_name: str, dimensions: int | None = None) -> Any:
        return self.embedder_cls(None, model_name, dimensions=dimensions)

    def embedding_input_limit(self, _connection_id: Any, _model_name: str) -> int | None:
        """Return the configured provider-published embedding limit."""
        return self.published_embedding_input_limit

    def input_modalities(self, _connection_id: Any, _model_name: str, _kind: Any) -> frozenset[str]:
        """Return the modalities the stub catalog publishes for any model."""
        return self.published_modalities

    def chat(self, _connection_id: Any) -> StubChatProvider:
        """Return the canned chat provider for any connection."""
        return self.chat_provider

    def request_concurrency(self, _connection_id: Any) -> int:
        """Return the configured concurrent-call cap for any connection."""
        return self.chat_concurrency

    def request_rpm(self, _connection_id: Any) -> int | None:
        """Tests run unpaced — RPM pacing is pinned in the throttle tests."""
        return None


class StubVectorStoreProvider:
    """Stands in for `VectorStoreProvider`: one shared store for any backend."""

    def __init__(self, store: StubVectorStore | None = None) -> None:
        self.store = store or StubVectorStore()
        self.requested_backends: list[IndexBackend] = []

    def get(self, backend: IndexBackend) -> StubVectorStore:
        self.requested_backends.append(backend)
        return self.store
