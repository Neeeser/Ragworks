from __future__ import annotations

import os
import sys
import unittest
from types import ModuleType, SimpleNamespace
from typing import Any, Iterable, List, Sequence
from unittest.mock import patch


def _ensure_stub(module_name: str, **attrs: Any) -> None:
    if module_name in sys.modules:
        return
    module = ModuleType(module_name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[module_name] = module


class _StubSentenceTransformer:
    pass


class _StubCrossEncoder:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.calls: list[tuple[Any, Any]] = []

    def predict(self, pairs: Iterable[tuple[str, str]]) -> list[float]:
        self.calls.append(tuple(pairs))
        return [0.0 for _ in pairs]


class _StubPdfReader:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass


_ensure_stub(
    "sentence_transformers",
    SentenceTransformer=_StubSentenceTransformer,
    CrossEncoder=_StubCrossEncoder,
)
_ensure_stub("pypdf", PdfReader=_StubPdfReader)


from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig
from app.retrieval.models import QueryRequest, RetrievalResponse, ScoredChunk
from app.retrieval.retrievers.pinecone_retriever import PineconeRetriever


class DummyEmbedder:
    def __init__(self, vector: Sequence[float]) -> None:
        self._vector = list(vector)
        self.queries: list[str] = []

    @property
    def vector(self) -> List[float]:
        return list(self._vector)

    def embed_query(self, text: str) -> List[float]:
        self.queries.append(text)
        return self.vector


class DummyReranker:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def rerank(
        self,
        *,
        query: str,
        candidates: Iterable[ScoredChunk],
        top_k: int,
    ) -> List[ScoredChunk]:
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


class PineconeRetrieverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = PineconeIndexConfig(
            name="test-index",
            namespace="config-namespace",
            text_key="content",
        )
        self.embedder = DummyEmbedder([0.1, 0.2, 0.3])

    def _build_match(self, *, chunk_id: str, document_id: str, score: float, order: int, text: str, **metadata: Any) -> FakeMatch:
        payload = dict(metadata)
        payload["document_id"] = document_id
        payload["order"] = order
        payload[self.config.text_key] = text
        return FakeMatch(match_id=chunk_id, score=score, metadata=payload)

    def test_retrieve_returns_scored_chunks_and_passes_expected_query_params(self) -> None:
        matches = [
            self._build_match(
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
            index_config=self.config,
            embedder=self.embedder,
            client=client,
        )
        request = QueryRequest(
            text="What is TransparentRAG?",
            top_k=3,
            namespace="request-namespace",
            filter={"category": "faq"},
        )

        response = retriever.retrieve(request)

        self.assertEqual(self.embedder.queries, [request.text])
        self.assertEqual(client.requested_names, [self.config.name])
        self.assertEqual(len(fake_index.query_calls), 1)
        query_kwargs = fake_index.query_calls[0]
        self.assertEqual(query_kwargs["namespace"], request.namespace)
        self.assertEqual(query_kwargs["top_k"], request.top_k)
        self.assertEqual(query_kwargs["filter"], request.filter)
        self.assertEqual(query_kwargs["vector"], self.embedder.vector)
        self.assertTrue(query_kwargs["include_metadata"])
        self.assertFalse(query_kwargs["include_values"])

        self.assertIsInstance(response, RetrievalResponse)
        self.assertEqual(len(response.matches), 1)
        scored_chunk = response.matches[0]
        self.assertAlmostEqual(scored_chunk.score, 0.82)
        chunk = scored_chunk.chunk
        self.assertEqual(chunk.document_id, "doc-1")
        self.assertEqual(chunk.chunk_id, "chunk-1")
        self.assertEqual(chunk.text, "First chunk text")
        self.assertEqual(chunk.order, 7)
        self.assertEqual(chunk.metadata.data, {"category": "faq"})

    def test_retrieve_uses_config_namespace_when_request_namespace_missing(self) -> None:
        matches = [
            self._build_match(
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
            index_config=self.config,
            embedder=self.embedder,
            client=client,
        )
        request = QueryRequest(text="Fallback namespace test", top_k=2)

        retriever.retrieve(request)

        query_kwargs = fake_index.query_calls[0]
        self.assertEqual(query_kwargs["namespace"], self.config.namespace)

    def test_retrieve_with_reranker_returns_reranked_matches(self) -> None:
        matches = [
            self._build_match(
                chunk_id="chunk-a",
                document_id="doc-a",
                score=0.4,
                order=1,
                text="Alpha text",
            ),
            self._build_match(
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
            index_config=self.config,
            embedder=self.embedder,
            client=client,
            reranker=reranker,
        )
        request = QueryRequest(text="Rerank me", top_k=2)

        response = retriever.retrieve(request)

        self.assertEqual(len(reranker.calls), 1)
        rerank_call = reranker.calls[0]
        self.assertEqual(rerank_call["query"], request.text)
        self.assertEqual(rerank_call["top_k"], request.top_k)
        self.assertEqual(len(rerank_call["candidates"]), 2)
        self.assertEqual([c.chunk.chunk_id for c in rerank_call["candidates"]], ["chunk-a", "chunk-b"])
        self.assertEqual([sc.chunk.chunk_id for sc in response.matches], ["chunk-b", "chunk-a"])

    def test_init_without_api_key_or_client_raises_value_error(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "Pinecone API key must be provided"):
                PineconeRetriever(
                    index_config=self.config,
                    embedder=self.embedder,
                )

    @patch("app.retrieval.retrievers.pinecone_retriever.Pinecone")
    def test_init_with_api_key_instantiates_pinecone_client(self, pinecone_cls: Any) -> None:
        fake_index = FakeIndex([])
        pinecone_instance = pinecone_cls.return_value
        pinecone_instance.Index.return_value = fake_index

        retriever = PineconeRetriever(
            index_config=self.config,
            embedder=self.embedder,
            api_key="explicit-key",
        )

        pinecone_cls.assert_called_once_with(api_key="explicit-key")
        pinecone_instance.Index.assert_called_once_with(self.config.name)
        self.assertIs(retriever._index, fake_index)


if __name__ == "__main__":
    unittest.main()
