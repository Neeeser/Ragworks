"""Pinecone store behavior with the SDK stubbed at the client boundary."""

from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

import pytest

from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.vectorstores.base import IndexSpec
from app.vectorstores.pinecone import PineconeStore


class _StubIndex:
    def __init__(self, matches: Sequence[Any] = ()) -> None:
        self.upsert_calls: list[dict[str, Any]] = []
        self.query_calls: list[dict[str, Any]] = []
        self.delete_calls: list[dict[str, Any]] = []
        self.delete_error: Exception | None = None
        self._matches = list(matches)

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
        filter={"category": "faq"},
    )

    kwargs = index.query_calls[0]
    assert kwargs["namespace"] == "ns-1"
    assert kwargs["top_k"] == 3
    assert kwargs["filter"] == {"category": "faq"}
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
