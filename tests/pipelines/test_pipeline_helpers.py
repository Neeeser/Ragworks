from __future__ import annotations

from uuid import uuid4

from app.db import models
from app.pipelines.config import resolve_ingestion_settings, resolve_retrieval_settings
from app.pipelines.definition import PipelineDefinition
from app.pipelines.nodes.chunking import ChunkerConfig
from app.pipelines.nodes.embedding import EmbedderConfig
from app.pipelines.nodes.indexing import IndexerConfig
from app.pipelines.nodes.retrieval import ChatSettingsConfig, RetrieverConfig
from app.pipelines.template import resolve_collection_template
from app.pipelines.tracing.summaries import (
    preview_text,
    summarize_chunks,
    summarize_embeddings,
    summarize_match_order,
    summarize_matches,
    summarize_text,
)
from app.retrieval.models import DocumentChunk, DocumentMetadata, ScoredChunk


def _collection() -> models.Collection:
    return models.Collection(
        id=uuid4(),
        user_id=uuid4(),
        name="Test Collection",
        description="",
        extra_metadata={},
    )


def test_resolve_collection_template_accepts_none() -> None:
    collection = _collection()

    assert resolve_collection_template(None, collection) is None


def test_resolve_ingestion_settings_defaults() -> None:
    definition = PipelineDefinition(nodes=[], edges=[])
    collection = _collection()

    settings = resolve_ingestion_settings(definition, collection)
    chunker = ChunkerConfig()
    embedder = EmbedderConfig()
    indexer = IndexerConfig()

    assert settings.chunk_size == chunker.chunk_size
    assert settings.chunk_overlap == chunker.chunk_overlap
    assert settings.chunk_strategy == chunker.strategy
    assert settings.embedding_model == embedder.model_name
    assert settings.index_name == indexer.index_name
    assert settings.namespace == resolve_collection_template(indexer.namespace, collection)


def test_resolve_retrieval_settings_defaults() -> None:
    definition = PipelineDefinition(nodes=[], edges=[])
    collection = _collection()

    settings = resolve_retrieval_settings(definition, collection)
    retriever = RetrieverConfig()
    embedder = EmbedderConfig()
    chat_settings = ChatSettingsConfig()

    assert settings.embedding_model == embedder.model_name
    assert settings.index_name == retriever.index_name
    assert settings.namespace == resolve_collection_template(retriever.namespace, collection)
    assert settings.chat_model == chat_settings.chat_model
    assert settings.context_window == chat_settings.context_window


def test_summaries_preview_and_summary() -> None:
    text = "alpha " * 100

    preview = preview_text(text, limit=10)

    assert preview.endswith("...")
    summary = summarize_text("short text", limit=10, full_limit=20)
    assert summary.preview == "short text"
    assert summary.full == "short text"
    long_summary = summarize_text("x" * 50, limit=10, full_limit=20)
    assert long_summary.full is None
    assert "full" not in long_summary.model_dump()


def test_summaries_chunk_and_embedding_summaries() -> None:
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="hello world",
        order=0,
        metadata=DocumentMetadata(),
        embedding=[0.1, 0.2, 0.3],
    )
    chunk_no_embed = DocumentChunk(
        document_id="doc",
        chunk_id="doc:1",
        text="second",
        order=1,
        metadata=DocumentMetadata(),
        embedding=None,
    )

    chunk_summary = summarize_chunks([chunk, chunk_no_embed])
    assert chunk_summary.count == 2
    assert chunk_summary.document_id == "doc"

    embed_summary = summarize_embeddings([chunk, chunk_no_embed])
    assert embed_summary.dimension == 3
    assert embed_summary.samples[1].preview is None
    empty_summary = summarize_chunks([])
    assert empty_summary.count == 0


def test_summaries_match_summaries() -> None:
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha beta",
        order=0,
        metadata=DocumentMetadata(),
    )
    matches = [ScoredChunk(chunk=chunk, score=0.9)]

    match_summary = summarize_matches(matches)
    assert match_summary.count == 1
    assert match_summary.top_matches[0].chunk_id == "doc:0"

    order_summary = summarize_match_order(matches)
    assert order_summary[0].rank == 1
