"""Helpers for resolving pipeline configuration values."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Type, TypeVar

from pydantic import BaseModel

from app.db import models
from app.pipelines.models import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.ingestion import (
    ChunkerConfig,
    EmbedderConfig,
    FixedChunkerConfig,
    IndexerConfig,
)
from app.pipelines.nodes.retrieval import ChatSettingsConfig, RetrieverConfig
from app.pipelines.template import resolve_collection_template

ConfigModel = TypeVar("ConfigModel", bound=BaseModel)


@dataclass(frozen=True)
class IngestionPipelineSettings:  # pylint: disable=too-many-instance-attributes
    """Resolved settings for ingestion pipelines."""

    chunk_strategy: models.ChunkStrategy
    chunk_size: int
    chunk_overlap: int
    embedding_model: str
    index_name: str
    namespace: Optional[str]
    dimension: Optional[int]
    metric: str


@dataclass(frozen=True)
class RetrievalPipelineSettings:  # pylint: disable=too-many-instance-attributes
    """Resolved settings for retrieval pipelines."""

    embedding_model: str
    index_name: str
    namespace: Optional[str]
    dimension: Optional[int]
    chat_model: str
    context_window: int


def _resolve_node_config(
    definition: PipelineDefinition,
    node_type: str,
    model: Type[ConfigModel],
) -> ConfigModel:
    """Return a validated config model for the first matching node type."""
    node: PipelineNodeDefinition | None = None
    for candidate in definition.nodes:
        if candidate.type == node_type:
            node = candidate
            break
    return model.model_validate(node.config if node else {})


def _resolve_chunker_config(definition: PipelineDefinition) -> ChunkerConfig:
    """Resolve chunking config from legacy or fixed-strategy chunkers."""
    fixed_strategies = [
        ("chunker.token", models.ChunkStrategy.TOKEN),
        ("chunker.sentence", models.ChunkStrategy.SENTENCE),
        ("chunker.paragraph", models.ChunkStrategy.PARAGRAPH),
        ("chunker.semantic", models.ChunkStrategy.SEMANTIC),
    ]
    for node_type, strategy in fixed_strategies:
        for candidate in definition.nodes:
            if candidate.type == node_type:
                config = FixedChunkerConfig.model_validate(candidate.config)
                return ChunkerConfig(
                    strategy=strategy,
                    chunk_size=config.chunk_size,
                    chunk_overlap=config.chunk_overlap,
                )
    return _resolve_node_config(definition, "chunker.collection", ChunkerConfig)


def resolve_ingestion_settings(
    definition: PipelineDefinition,
    collection: models.Collection,
) -> IngestionPipelineSettings:
    """Resolve ingestion settings from a pipeline definition."""
    chunker = _resolve_chunker_config(definition)
    embedder = _resolve_node_config(definition, "embedder.openrouter", EmbedderConfig)
    indexer = _resolve_node_config(definition, "indexer.pinecone", IndexerConfig)
    index_name = (
        resolve_collection_template(indexer.index_name, collection) or indexer.index_name
    )
    namespace = resolve_collection_template(indexer.namespace, collection)
    return IngestionPipelineSettings(
        chunk_strategy=chunker.strategy,
        chunk_size=chunker.chunk_size,
        chunk_overlap=chunker.chunk_overlap,
        embedding_model=embedder.model_name,
        index_name=index_name,
        namespace=namespace,
        dimension=indexer.dimension,
        metric=indexer.metric,
    )


def resolve_retrieval_settings(
    definition: PipelineDefinition,
    collection: models.Collection,
) -> RetrievalPipelineSettings:
    """Resolve retrieval settings from a pipeline definition."""
    retriever = _resolve_node_config(definition, "retriever.pinecone", RetrieverConfig)
    embedder = _resolve_node_config(definition, "embedder.openrouter", EmbedderConfig)
    chat_settings = _resolve_node_config(definition, "chat.settings", ChatSettingsConfig)
    index_name = (
        resolve_collection_template(retriever.index_name, collection)
        or retriever.index_name
    )
    namespace = resolve_collection_template(retriever.namespace, collection)
    return RetrievalPipelineSettings(
        embedding_model=embedder.model_name,
        index_name=index_name,
        namespace=namespace,
        dimension=embedder.dimension,
        chat_model=chat_settings.chat_model,
        context_window=chat_settings.context_window,
    )
