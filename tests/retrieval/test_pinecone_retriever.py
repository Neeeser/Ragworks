from __future__ import annotations

import os
from collections.abc import Iterable, Sequence
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from app.clients.pinecone import client as pinecone_client_module
from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig
from app.retrieval.models import QueryRequest, RetrievalResponse, ScoredChunk
from app.retrieval.retrievers.pinecone_retriever import PineconeRetriever


class DummyReranker:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def rerank(
        self,
        *,
        query: str,
        candidates: Iterable[ScoredChunk],
        top_k: int,
    ) -> list[ScoredChunk]:
        snapshot = list(candidates)
        self.calls.append({"query": query, "candidates": snapshot, "top_k": top_k})
        return list(reversed(snapshot))[:top_k]


class FakeMatch:
    def __init__(self, match_id: str, score: float, metadata: dict[str, Any]) -> None:
        self.id = match_id
        self.score = score
        self.metadata = metadata


class FakeIndex:
    def __init__(self, matches: Sequence[FakeMatch]) -> None:
        self._matches = list(matches)
        self.query_calls: list[dict[str, Any]] = []

    def query(self, **kwargs: Any) -> SimpleNamespace:
        self.query_calls.append(dict(kwargs))
        return SimpleNamespace(matches=list(self._matches))


class FakePineconeClient:
    def __init__(self, index: FakeIndex) -> None:
        self._index = index
        self.requested_names: list[str] = []

    def Index(self, name: str) -> FakeIndex:
        self.requested_names.append(name)
        return self._index


@pytest.fixture(name="config")
def config_fixture() -> PineconeIndexConfig:
    return PineconeIndexConfig(
        name="test-index",
        namespace="config-namespace",
        text_key="content",
    )


@pytest.fixture(name="query_vector")
def query_vector_fixture() -> list[float]:
    return [0.1, 0.2, 0.3]


def _build_match(
    config: PineconeIndexConfig,
    *,
    chunk_id: str,
    document_id: str,
    score: float,
    order: int,
    text: str,
    **metadata: Any,
) -> FakeMatch:
    payload = dict(metadata)
    payload["document_id"] = document_id
    payload["order"] = order
    payload[config.text_key] = text
    return FakeMatch(match_id=chunk_id, score=score, metadata=payload)


def test_retrieve_returns_scored_chunks_and_passes_expected_query_params(
    config: PineconeIndexConfig, query_vector: list[float]
) -> None:
    matches = [
        _build_match(
            config,
            chunk_id="chunk-1",
            document_id="doc-1",
            score=0.82,
            order=7,
            text="First chunk text",
            category="faq",
        )
    ]
    fake_index = FakeIndex(matches)
    client = FakePineconeClient(fake_index)
    retriever = PineconeRetriever(
        index_config=config,
        client=client,
    )
    request = QueryRequest(
        text="What is TransparentRAG?",
        top_k=3,
        namespace="request-namespace",
        filter={"category": "faq"},
    )

    response = retriever.retrieve(request, embedding=query_vector)

    assert client.requested_names == [config.name]
    assert len(fake_index.query_calls) == 1
    query_kwargs = fake_index.query_calls[0]
    assert query_kwargs["namespace"] == request.namespace
    assert query_kwargs["top_k"] == request.top_k
    assert query_kwargs["filter"] == request.filter
    assert query_kwargs["vector"] == query_vector
    assert query_kwargs["include_metadata"]
    assert not query_kwargs["include_values"]

    assert isinstance(response, RetrievalResponse)
    assert len(response.matches) == 1
    scored_chunk = response.matches[0]
    assert scored_chunk.score == pytest.approx(0.82)
    chunk = scored_chunk.chunk
    assert chunk.document_id == "doc-1"
    assert chunk.chunk_id == "chunk-1"
    assert chunk.text == "First chunk text"
    assert chunk.order == 7
    assert chunk.metadata.data == {"category": "faq"}


def test_retrieve_uses_config_namespace_when_request_namespace_missing(
    config: PineconeIndexConfig, query_vector: list[float]
) -> None:
    matches = [
        _build_match(
            config,
            chunk_id="chunk-2",
            document_id="doc-2",
            score=0.67,
            order=4,
            text="Another piece of text",
        )
    ]
    fake_index = FakeIndex(matches)
    client = FakePineconeClient(fake_index)
    retriever = PineconeRetriever(
        index_config=config,
        client=client,
    )
    request = QueryRequest(text="Fallback namespace test", top_k=2)

    retriever.retrieve(request, embedding=query_vector)

    query_kwargs = fake_index.query_calls[0]
    assert query_kwargs["namespace"] == config.namespace


def test_retrieve_with_reranker_returns_reranked_matches(
    config: PineconeIndexConfig, query_vector: list[float]
) -> None:
    matches = [
        _build_match(
            config,
            chunk_id="chunk-a",
            document_id="doc-a",
            score=0.4,
            order=1,
            text="Alpha text",
        ),
        _build_match(
            config,
            chunk_id="chunk-b",
            document_id="doc-b",
            score=0.9,
            order=2,
            text="Beta text",
        ),
    ]
    fake_index = FakeIndex(matches)
    client = FakePineconeClient(fake_index)
    reranker = DummyReranker()
    retriever = PineconeRetriever(
        index_config=config,
        client=client,
        reranker=reranker,
    )
    request = QueryRequest(text="Rerank me", top_k=2)

    response = retriever.retrieve(request, embedding=query_vector)

    assert len(reranker.calls) == 1
    rerank_call = reranker.calls[0]
    assert rerank_call["query"] == request.text
    assert rerank_call["top_k"] == request.top_k
    assert len(rerank_call["candidates"]) == 2
    assert [c.chunk.chunk_id for c in rerank_call["candidates"]] == ["chunk-a", "chunk-b"]
    assert [sc.chunk.chunk_id for sc in response.matches] == ["chunk-b", "chunk-a"]


def test_retrieve_falls_back_to_match_id_when_document_id_missing(
    config: PineconeIndexConfig, query_vector: list[float]
) -> None:
    """Metadata without `document_id` falls back to the match id (not an error)."""
    match = FakeMatch(match_id="chunk-3", score=0.5, metadata={config.text_key: "orphan chunk"})
    fake_index = FakeIndex([match])
    client = FakePineconeClient(fake_index)
    retriever = PineconeRetriever(index_config=config, client=client)
    request = QueryRequest(text="No document id", top_k=1)

    response = retriever.retrieve(request, embedding=query_vector)

    chunk = response.matches[0].chunk
    assert chunk.document_id == "chunk-3"
    assert chunk.order == 0


def test_init_without_api_key_or_client_raises_value_error(config: PineconeIndexConfig) -> None:
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(ValueError, match="Pinecone API key must be provided"):
            PineconeRetriever(
                index_config=config,
            )


@patch.object(pinecone_client_module, "Pinecone")
def test_init_with_api_key_instantiates_pinecone_client(
    pinecone_cls: Any, config: PineconeIndexConfig
) -> None:
    fake_index = FakeIndex([])
    pinecone_instance = pinecone_cls.return_value
    pinecone_instance.Index.return_value = fake_index

    retriever = PineconeRetriever(
        index_config=config,
        api_key="explicit-key",
    )

    pinecone_cls.assert_called_once_with(api_key="explicit-key")
    pinecone_instance.Index.assert_called_once_with(config.name)
    assert retriever._index is fake_index
