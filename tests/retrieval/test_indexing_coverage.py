from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.retrieval.indexing import DocumentIndexer
from app.retrieval.models import Document, DocumentChunk, DocumentMetadata
from app.retrieval.parsers.base import DocumentSource


@dataclass
class _StubChunker:
    chunks: list[DocumentChunk]

    def chunk(self, _document: Document):
        return self.chunks


@dataclass
class _StubEmbedder:
    embeddings: list[list[float]]
    called: int = 0

    def embed_documents(self, _chunks):
        self.called += 1
        return self.embeddings


@dataclass
class _StubIndexer:
    ensured: int = 0
    upserts: int = 0

    def ensure_index(self, _config):
        self.ensured += 1

    def upsert(self, **_kwargs):
        self.upserts += 1


@dataclass
class _StubParser:
    document: Document

    def parse(self, _source: DocumentSource) -> Document:
        return self.document


def _document(text: str = "hello") -> Document:
    return Document(
        document_id="doc",
        text=text,
        metadata=DocumentMetadata(),
    )


def test_index_document_returns_empty_when_no_chunks() -> None:
    chunker = _StubChunker([])
    embedder = _StubEmbedder([])
    indexer = _StubIndexer()
    config = object()
    indexer_service = DocumentIndexer(chunker, embedder, indexer, config)

    result = indexer_service.index_document(_document(""))

    assert result == []
    assert embedder.called == 0
    assert indexer.upserts == 0


def test_index_document_raises_on_embedding_mismatch() -> None:
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="chunk",
        order=0,
        metadata=DocumentMetadata(),
    )
    chunker = _StubChunker([chunk, chunk])
    embedder = _StubEmbedder([[0.1, 0.2]])
    indexer = _StubIndexer()
    config = object()
    indexer_service = DocumentIndexer(chunker, embedder, indexer, config)

    with pytest.raises(ValueError, match="Mismatch between chunks"):
        indexer_service.index_document(_document("text"))


def test_index_source_requires_parser() -> None:
    chunker = _StubChunker([])
    embedder = _StubEmbedder([])
    indexer = _StubIndexer()
    config = object()
    indexer_service = DocumentIndexer(chunker, embedder, indexer, config)

    source = DocumentSource(document_id="doc", path="/tmp/doc.txt", content_type="text/plain")

    with pytest.raises(ValueError, match="Document parser is not configured"):
        indexer_service.index_source(source)


def test_index_sources_only_ensures_index_once() -> None:
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="chunk",
        order=0,
        metadata=DocumentMetadata(),
    )
    chunker = _StubChunker([chunk])
    embedder = _StubEmbedder([[0.1, 0.2]])
    indexer = _StubIndexer()
    config = object()
    parser = _StubParser(_document("text"))
    indexer_service = DocumentIndexer(chunker, embedder, indexer, config, parser=parser)

    sources = [
        DocumentSource(document_id="doc", path="/tmp/a.txt", content_type="text/plain"),
        DocumentSource(document_id="doc", path="/tmp/b.txt", content_type="text/plain"),
    ]

    result = indexer_service.index_sources(sources)

    assert len(result) == 2
    assert indexer.ensured == 1
    assert indexer.upserts == 2
