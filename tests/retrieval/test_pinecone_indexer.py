from __future__ import annotations

from typing import Any

import pytest

from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig, PineconeIndexer
from app.retrieval.indexers import pinecone_indexer as pinecone_module
from app.retrieval import pinecone as pinecone_client_module
from app.retrieval.models import DocumentChunk, DocumentMetadata


class _StubIndex:
    def __init__(self) -> None:
        self.upsert_calls: list[dict[str, Any]] = []

    def upsert(self, *, vectors: list[dict[str, Any]], namespace: str | None = None) -> None:
        self.upsert_calls.append({"vectors": vectors, "namespace": namespace})


class _StubPinecone:
    def __init__(self, has_index: bool = False, include_metadata_param: bool = True) -> None:
        self._has_index = has_index
        self._include_metadata_param = include_metadata_param
        self.created: dict[str, Any] | None = None
        self.deleted: str | None = None
        self.requested_names: list[str] = []
        self.index = _StubIndex()

    def has_index(self, _name: str) -> bool:
        return self._has_index

    def create_index(self, name: str, dimension: int, metric: str, spec: Any, deletion_protection: str, metadata_config: Any = None) -> None:
        if not self._include_metadata_param and metadata_config is not None:
            raise AssertionError("metadata_config should not be provided")
        self.created = {
            "name": name,
            "dimension": dimension,
            "metric": metric,
            "spec": spec,
            "deletion_protection": deletion_protection,
            "metadata_config": metadata_config,
        }

    def delete_index(self, name: str) -> None:
        self.deleted = name

    def Index(self, name: str) -> _StubIndex:
        self.requested_names.append(name)
        return self.index


class _StubPineconeNoMetadata:
    def __init__(self) -> None:
        self.created: dict[str, Any] | None = None

    def has_index(self, _name: str) -> bool:
        return False

    def create_index(self, name: str, dimension: int, metric: str, spec: Any, deletion_protection: str) -> None:
        self.created = {
            "name": name,
            "dimension": dimension,
            "metric": metric,
            "spec": spec,
            "deletion_protection": deletion_protection,
        }

    def Index(self, name: str) -> _StubIndex:
        return _StubIndex()


def _chunk(text: str, embedding: list[float] | None) -> DocumentChunk:
    return DocumentChunk(
        document_id="doc-1",
        chunk_id="chunk-1",
        text=text,
        order=0,
        metadata=DocumentMetadata(data={"source": "unit"}),
        embedding=embedding,
    )


def test_ensure_index_skips_when_present() -> None:
    client = _StubPinecone(has_index=True)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index")

    indexer.ensure_index(config)

    assert client.created is None


def test_ensure_index_includes_metadata_config_when_supported() -> None:
    client = _StubPinecone(has_index=False, include_metadata_param=True)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index", metadata_config={"indexed": ["source"]})

    indexer.ensure_index(config)

    assert client.created is not None
    assert client.created["metadata_config"] == {"indexed": ["source"]}


def test_ensure_index_drops_metadata_config_when_not_supported() -> None:
    client = _StubPineconeNoMetadata()
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index", metadata_config={"indexed": ["source"]})

    indexer.ensure_index(config)

    assert client.created is not None
    assert "metadata_config" not in client.created


def test_upsert_builds_vectors_and_uses_namespace() -> None:
    client = _StubPinecone(has_index=False)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index", namespace="config-ns", text_key="text")

    indexer.upsert(config=config, chunks=[_chunk("hello", [0.1, 0.2])], namespace=None)

    assert client.requested_names == ["unit-index"]
    call = client.index.upsert_calls[0]
    assert call["namespace"] == "config-ns"
    vector = call["vectors"][0]
    assert vector["metadata"]["document_id"] == "doc-1"
    assert vector["metadata"]["order"] == 0
    assert vector["metadata"]["text"] == "hello"


def test_upsert_raises_when_embedding_missing() -> None:
    client = _StubPinecone(has_index=False)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index")

    with pytest.raises(ValueError, match="missing embedding"):
        indexer.upsert(config=config, chunks=[_chunk("hello", None)], namespace="ns")


def test_delete_index_clears_cache() -> None:
    client = _StubPinecone(has_index=True)
    indexer = PineconeIndexer(client=client)
    indexer._indexes["unit-index"] = object()

    indexer.delete_index("unit-index")

    assert client.deleted == "unit-index"
    assert "unit-index" not in indexer._indexes


def test_init_requires_api_key_when_client_missing(monkeypatch) -> None:
    monkeypatch.delenv("TEST_PINECONE_API_KEY", raising=False)

    with pytest.raises(ValueError, match="Pinecone API key must be provided"):
        PineconeIndexer(client=None, api_key=None)


def test_upsert_returns_when_no_chunks() -> None:
    client = _StubPinecone(has_index=False)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index")

    indexer.upsert(config=config, chunks=[], namespace="ns")

    assert client.requested_names == []


def test_init_uses_api_key_when_client_missing(monkeypatch) -> None:
    captured: dict[str, str] = {}

    class _StubPineconeClient:
        def __init__(self, api_key: str) -> None:
            captured["api_key"] = api_key

    monkeypatch.setattr(pinecone_client_module, "Pinecone", _StubPineconeClient)

    indexer = PineconeIndexer(client=None, api_key="unit-key")

    assert isinstance(indexer._client, _StubPineconeClient)
    assert captured["api_key"] == "unit-key"


def test_ensure_index_without_metadata_config_creates_index() -> None:
    client = _StubPinecone(has_index=False)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index")

    indexer.ensure_index(config)

    assert client.created is not None


def test_ensure_index_handles_signature_errors(monkeypatch) -> None:
    client = _StubPineconeNoMetadata()
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index", metadata_config={"indexed": ["source"]})

    def _raise_signature_error(*_args, **_kwargs):
        raise TypeError("signature not available")

    monkeypatch.setattr(pinecone_module.inspect, "signature", _raise_signature_error)

    indexer.ensure_index(config)

    assert client.created is not None


def test_delete_index_skips_when_missing() -> None:
    client = _StubPinecone(has_index=False)
    indexer = PineconeIndexer(client=client)
    indexer._indexes["unit-index"] = object()

    indexer.delete_index("unit-index")

    assert client.deleted is None
    assert "unit-index" not in indexer._indexes


def test_get_index_reuses_cached_index() -> None:
    client = _StubPinecone(has_index=False)
    indexer = PineconeIndexer(client=client)
    config = PineconeIndexConfig(name="unit-index")
    chunk = _chunk("hello", [0.1, 0.2])

    indexer.upsert(config=config, chunks=[chunk], namespace="ns")
    indexer.upsert(config=config, chunks=[chunk], namespace="ns")

    assert client.requested_names == ["unit-index"]
