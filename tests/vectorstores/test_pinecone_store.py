"""Pinecone store behavior with the SDK stubbed at the client boundary."""

from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

import pytest
from pinecone.exceptions import NotFoundException as PineconeNotFoundException

from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.metadata_filter import FilterCondition, MetadataFilter
from app.vectorstores.base import IndexSpec
from app.vectorstores.pinecone import PineconeStore
from app.vectorstores.pinecone.store import MAX_FETCH_IDS


class _StubIndex:
    def __init__(self, matches: Sequence[Any] = ()) -> None:
        self.upsert_calls: list[dict[str, Any]] = []
        self.query_calls: list[dict[str, Any]] = []
        self.delete_calls: list[dict[str, Any]] = []
        self.delete_error: Exception | None = None
        self.list_error: Exception | None = None
        #: Id batches `list` yields, as the SDK paginates them.
        self.list_batches: list[list[str]] = []
        self.list_calls: list[dict[str, Any]] = []
        #: Vectors `fetch` answers, keyed by id.
        self.vectors: dict[str, Any] = {}
        self.fetch_calls: list[dict[str, Any]] = []
        self.fetch_error: Exception | None = None
        self._matches = list(matches)

    def list(self, **kwargs: Any) -> Any:
        self.list_calls.append(dict(kwargs))
        if self.list_error is not None:
            raise self.list_error
        return iter(list(self.list_batches))

    def fetch(self, *, ids: list[str], namespace: str | None = None) -> Any:
        self.fetch_calls.append({"ids": list(ids), "namespace": namespace})
        if self.fetch_error is not None:
            raise self.fetch_error
        return SimpleNamespace(
            vectors={vid: self.vectors[vid] for vid in ids if vid in self.vectors}
        )

    def upsert(self, *, vectors: list[dict[str, Any]], namespace: str | None = None) -> None:
        self.upsert_calls.append({"vectors": vectors, "namespace": namespace})

    def query(self, **kwargs: Any) -> SimpleNamespace:
        self.query_calls.append(dict(kwargs))
        return SimpleNamespace(matches=list(self._matches))

    def delete(self, **kwargs: Any) -> None:
        if self.delete_error is not None:
            raise self.delete_error
        self.delete_calls.append(dict(kwargs))


class _FakeMatch:
    def __init__(self, match_id: str, score: float, metadata: dict[str, Any] | None) -> None:
        self.id = match_id
        self.score = score
        self.metadata = metadata


class _StubPinecone:
    def __init__(self, *, has_index: bool = False, index: _StubIndex | None = None) -> None:
        self._has_index = has_index
        self.created: dict[str, Any] | None = None
        self.requested_names: list[str] = []
        self.index = index or _StubIndex()

    def has_index(self, _name: str) -> bool:
        return self._has_index

    def create_index(self, **kwargs: Any) -> None:
        self.created = dict(kwargs)

    def Index(self, name: str) -> _StubIndex:
        self.requested_names.append(name)
        return self.index


def _chunk(chunk_id: str, embedding: list[float] | None, text: str = "hello") -> DocumentChunk:
    return DocumentChunk(
        document_id="doc-1",
        chunk_id=chunk_id,
        text=text,
        order=0,
        metadata=DocumentMetadata(data={"source": "unit"}),
        embedding=embedding,
    )


def test_ensure_index_skips_when_present() -> None:
    client = _StubPinecone(has_index=True)
    store = PineconeStore(client)  # type: ignore[arg-type]

    store.ensure_index(IndexSpec(name="unit-index", dimension=768))

    assert client.created is None


def test_ensure_index_creates_when_absent() -> None:
    client = _StubPinecone(has_index=False)
    store = PineconeStore(client)  # type: ignore[arg-type]

    store.ensure_index(IndexSpec(name="unit-index", dimension=768, metric="dotproduct"))

    assert client.created is not None
    assert client.created["name"] == "unit-index"
    assert client.created["dimension"] == 768
    assert client.created["metric"] == "dotproduct"


def test_upsert_builds_vectors_with_text_and_identity_metadata() -> None:
    client = _StubPinecone()
    store = PineconeStore(client)  # type: ignore[arg-type]

    store.upsert("unit-index", "ns-1", [_chunk("chunk-1", [0.1, 0.2])])

    assert client.requested_names == ["unit-index"]
    call = client.index.upsert_calls[0]
    assert call["namespace"] == "ns-1"
    vector = call["vectors"][0]
    assert vector["id"] == "chunk-1"
    assert vector["values"] == [0.1, 0.2]
    assert vector["metadata"]["document_id"] == "doc-1"
    assert vector["metadata"]["order"] == 0
    assert vector["metadata"]["text"] == "hello"
    assert vector["metadata"]["source"] == "unit"


def test_upsert_raises_when_embedding_missing() -> None:
    store = PineconeStore(_StubPinecone())  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="missing embedding"):
        store.upsert("unit-index", "ns-1", [_chunk("chunk-1", None)])


def test_upsert_no_chunks_is_a_no_op() -> None:
    client = _StubPinecone()
    store = PineconeStore(client)  # type: ignore[arg-type]

    store.upsert("unit-index", "ns-1", [])

    assert client.requested_names == []


def test_query_converts_matches_and_passes_params() -> None:
    match = _FakeMatch(
        "chunk-1",
        0.82,
        {"document_id": "doc-1", "order": 7, "text": "First chunk", "category": "faq"},
    )
    index = _StubIndex(matches=[match])
    client = _StubPinecone(index=index)
    store = PineconeStore(client)  # type: ignore[arg-type]

    response = store.query(
        "unit-index",
        "ns-1",
        embedding=[0.1, 0.2, 0.3],
        top_k=3,
        filter=MetadataFilter(all=[FilterCondition(field="category", value="faq")]),
    )

    kwargs = index.query_calls[0]
    assert kwargs["namespace"] == "ns-1"
    assert kwargs["top_k"] == 3
    assert kwargs["filter"] == {"$and": [{"category": {"$eq": "faq"}}]}
    assert kwargs["vector"] == [0.1, 0.2, 0.3]
    assert kwargs["include_metadata"]
    assert not kwargs["include_values"]

    scored = response.matches[0]
    assert scored.score == pytest.approx(0.82)
    assert scored.chunk.document_id == "doc-1"
    assert scored.chunk.chunk_id == "chunk-1"
    assert scored.chunk.text == "First chunk"
    assert scored.chunk.order == 7
    assert scored.chunk.metadata.data == {"category": "faq"}


def test_query_handles_none_metadata() -> None:
    index = _StubIndex(matches=[_FakeMatch("chunk-none", 0.2, None)])
    store = PineconeStore(_StubPinecone(index=index))  # type: ignore[arg-type]

    response = store.query("unit-index", "ns-1", embedding=[0.1], top_k=1)

    chunk = response.matches[0].chunk
    assert chunk.document_id == "chunk-none"
    assert chunk.text == ""
    assert chunk.metadata.data == {}


def test_query_index_handle_is_cached() -> None:
    client = _StubPinecone()
    store = PineconeStore(client)  # type: ignore[arg-type]
    chunk = _chunk("chunk-1", [0.1])

    store.upsert("unit-index", "ns", [chunk])
    store.upsert("unit-index", "ns", [chunk])

    assert client.requested_names == ["unit-index"]


def test_delete_namespace_swallows_missing_namespace() -> None:
    index = _StubIndex()
    index.delete_error = RuntimeError("Namespace not found")
    store = PineconeStore(_StubPinecone(index=index))  # type: ignore[arg-type]

    store.delete_namespace("unit-index", "ns-1")  # does not raise


def test_delete_namespace_raises_other_errors() -> None:
    index = _StubIndex()
    index.delete_error = RuntimeError("rate limited")
    store = PineconeStore(_StubPinecone(index=index))  # type: ignore[arg-type]

    with pytest.raises(RuntimeError, match="rate limited"):
        store.delete_namespace("unit-index", "ns-1")


def test_delete_document_vectors_tolerates_missing_index() -> None:
    """Purging a document from a never-created index is a no-op, not a failure."""
    index = _StubIndex()
    index.list_error = PineconeNotFoundException("Resource unit-bm25 not found")
    store = PineconeStore(_StubPinecone(index=index))  # type: ignore[arg-type]

    store.delete_document_vectors("unit-bm25", "ns-1", "doc-1")  # does not raise


def test_delete_namespace_tolerates_missing_index() -> None:
    """Purging a namespace on a never-created index is a no-op, not a failure."""
    index = _StubIndex()
    index.delete_error = PineconeNotFoundException("Resource unit-bm25 not found")
    store = PineconeStore(_StubPinecone(index=index))  # type: ignore[arg-type]

    store.delete_namespace("unit-bm25", "ns-1")  # does not raise


class _StubLexicalIndex(_StubIndex):
    def __init__(self, hits: Sequence[dict[str, Any]] = ()) -> None:
        super().__init__()
        self.upsert_records_calls: list[dict[str, Any]] = []
        self.search_calls: list[dict[str, Any]] = []
        self._hits = list(hits)

    def upsert_records(self, namespace: str, records: list[dict[str, Any]]) -> None:
        self.upsert_records_calls.append({"namespace": namespace, "records": records})

    def search(self, *, namespace: str, query: dict[str, Any]) -> SimpleNamespace:
        self.search_calls.append({"namespace": namespace, "query": query})
        return SimpleNamespace(result=SimpleNamespace(hits=list(self._hits)))


class _StubModelPinecone(_StubPinecone):
    """Adds the integrated-embedding control-plane surface to the stub."""

    def __init__(self, *, has_index: bool = False, index: _StubIndex | None = None) -> None:
        super().__init__(has_index=has_index, index=index)
        self.created_for_model: dict[str, Any] | None = None

    def create_index_for_model(self, **kwargs: Any) -> None:
        self.created_for_model = dict(kwargs)

    def describe_index(self, name: str) -> dict[str, Any]:
        return {"name": name, "vector_type": "sparse", "metric": "dotproduct"}


def test_ensure_index_sparse_creates_integrated_text_index() -> None:
    client = _StubModelPinecone(has_index=False)
    store = PineconeStore(client)  # type: ignore[arg-type]

    store.ensure_index(IndexSpec(name="unit-bm25", vector_type="sparse"))

    assert client.created is None  # not the dense path
    assert client.created_for_model is not None
    assert client.created_for_model["name"] == "unit-bm25"
    embed = client.created_for_model["embed"]
    assert embed.model == "pinecone-sparse-english-v0"
    assert embed.field_map == {"text": "chunk_text"}


def test_upsert_lexical_sends_text_records() -> None:
    index = _StubLexicalIndex()
    client = _StubModelPinecone(has_index=True, index=index)
    store = PineconeStore(client)  # type: ignore[arg-type]

    store.upsert_lexical("unit-bm25", "ns-1", [_chunk("doc-1:0", None, text="lexical text")])

    assert len(index.upsert_records_calls) == 1
    call = index.upsert_records_calls[0]
    assert call["namespace"] == "ns-1"
    assert call["records"] == [
        {
            "source": "unit",
            "_id": "doc-1:0",
            "chunk_text": "lexical text",
            "document_id": "doc-1",
            "order": 0,
        }
    ]


def test_lexical_query_converts_hits_to_scored_chunks() -> None:
    hits = [
        {
            "_id": "doc-1:2",
            "_score": 3.25,
            "fields": {
                "chunk_text": "matched text",
                "document_id": "doc-1",
                "order": 2,
                "source": "unit",
            },
        },
        {"_id": "doc-2:0", "_score": 1.5, "fields": {"chunk_text": "second"}},
    ]
    index = _StubLexicalIndex(hits=hits)
    client = _StubModelPinecone(has_index=True, index=index)
    store = PineconeStore(client)  # type: ignore[arg-type]

    response = store.lexical_query("unit-bm25", "ns-1", text="matched", top_k=5)

    assert index.search_calls == [
        {"namespace": "ns-1", "query": {"inputs": {"text": "matched"}, "top_k": 5}}
    ]
    first, second = response.matches
    assert first.chunk.chunk_id == "doc-1:2"
    assert first.chunk.text == "matched text"
    assert first.chunk.document_id == "doc-1"
    assert first.chunk.order == 2
    assert first.chunk.metadata.data == {"source": "unit"}
    assert first.score == 3.25
    assert second.chunk.document_id == "doc-2:0"  # falls back to the hit id
    assert second.score == 1.5


class _FakeVector:
    def __init__(self, metadata: dict[str, Any]) -> None:
        self.metadata = metadata


def _stored(document_id: str, order: int) -> _FakeVector:
    return _FakeVector(
        {"text": f"chunk-{order}", "document_id": document_id, "order": order, "src": "a.pdf"}
    )


def _lineage_store() -> tuple[PineconeStore, _StubIndex]:
    index = _StubIndex()
    index.list_batches = [["doc-1:2", "doc-1:10"], ["doc-1:1"]]
    index.vectors = {
        "doc-1:2": _stored("doc-1", 2),
        "doc-1:10": _stored("doc-1", 10),
        "doc-1:1": _stored("doc-1", 1),
    }
    return PineconeStore(client=_StubPinecone(has_index=True, index=index)), index


def test_fetch_document_chunks_lists_by_prefix_then_orders_by_chunk_order() -> None:
    """`fetch` answers an unordered mapping, so the store imposes chunk order."""
    store, index = _lineage_store()

    chunks = store.fetch_document_chunks("docs", "ns", "doc-1", limit=100)

    assert index.list_calls[0]["prefix"] == "doc-1:"
    assert index.list_calls[0]["namespace"] == "ns"
    assert [chunk.order for chunk in chunks] == [1, 2, 10]
    assert [chunk.chunk_id for chunk in chunks] == ["doc-1:1", "doc-1:2", "doc-1:10"]
    # text/document_id/order are lifted out; the document's own metadata stays.
    assert chunks[0].text == "chunk-1"
    assert chunks[0].metadata.data == {"src": "a.pdf"}


def test_fetch_document_chunks_stops_listing_at_its_limit() -> None:
    store, index = _lineage_store()

    chunks = store.fetch_document_chunks("docs", "ns", "doc-1", limit=2)

    assert index.fetch_calls[0]["ids"] == ["doc-1:2", "doc-1:10"]
    assert len(chunks) == 2


def test_fetch_document_chunks_on_a_missing_index_is_empty() -> None:
    index = _StubIndex()
    index.list_error = PineconeNotFoundException("no such index")
    store = PineconeStore(client=_StubPinecone(index=index))

    assert store.fetch_document_chunks("docs", "ns", "doc-1", limit=100) == []


def test_fetch_document_chunks_with_no_stored_ids_never_fetches() -> None:
    index = _StubIndex()
    store = PineconeStore(client=_StubPinecone(has_index=True, index=index))

    assert store.fetch_document_chunks("docs", "ns", "doc-1", limit=100) == []
    assert index.fetch_calls == []


def test_fetch_document_chunks_batches_ids_to_the_api_cap() -> None:
    """Fetch takes at most 1000 ids per request, so a larger lineage batches.

    A single oversized request is rejected outright
    (docs/external-api/pinecone/guides/manage-data/fetch-data.md), so the cap
    cannot be left to whatever limit the caller passes.
    """
    total = MAX_FETCH_IDS + 250
    index = _StubIndex()
    index.list_batches = [[f"doc-1:{order}" for order in range(total)]]
    index.vectors = {f"doc-1:{order}": _stored("doc-1", order) for order in range(total)}
    store = PineconeStore(client=_StubPinecone(has_index=True, index=index))

    chunks = store.fetch_document_chunks("docs", "ns", "doc-1", limit=total)

    assert [len(call["ids"]) for call in index.fetch_calls] == [MAX_FETCH_IDS, 250]
    assert len(chunks) == total
    # Ordering still holds across the batch boundary.
    assert [chunk.order for chunk in chunks] == list(range(total))
