"""Helpers for resolving pipeline configuration values from node definitions.

Config extraction is driven by the node classes themselves: a node's `type`
class attribute is the single source of truth for its type id, so this module
never re-hardcodes a type id as a string literal that could drift from the
node class that owns it. The one exception that needs a little more than a
single lookup is chunking -- there's a family of fixed-strategy chunker
classes (`chunker.token`, `chunker.sentence`, ...) plus the configurable
`chunker.collection` -- so `_resolve_chunker_config` walks the *registry's*
node classes to find whichever chunker variant is present, reading its
`type`/`strategy` off the class rather than a hardcoded type-id-to-strategy
table.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel

from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.pipelines.nodes.chunking import (
    BaseChunkerNode,
    ChunkerConfig,
    ChunkerNode,
    FixedChunkerConfig,
)
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.nodes.indexing import (
    BaseIndexerNode,
    IndexerConfig,
    VectorIndexerNode,
    default_index_name,
)
from app.pipelines.nodes.retrieval import (
    BaseRetrieverNode,
    RetrieverConfig,
    VectorRetrieverNode,
)
from app.pipelines.registry import NodeRegistry
from app.pipelines.template import resolve_collection_template
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config

ConfigModel = TypeVar("ConfigModel", bound=BaseModel)


@dataclass(frozen=True)
class IngestionPipelineSettings:  # pylint: disable=too-many-instance-attributes
    """Resolved settings for ingestion pipelines."""

    chunk_strategy: models.ChunkStrategy
    chunk_size: int
    chunk_overlap: int
    embedding_model: str
    backend: IndexBackend
    index_name: str
    namespace: str | None
    dimension: int | None
    metric: str


@dataclass(frozen=True)
class RetrievalPipelineSettings:
    """Resolved settings for retrieval pipelines.

    Chat model and context window deliberately live outside the pipeline --
    they are session-level choices made in the chat UI, not retrieval
    behavior (the old `chat.settings` node was removed for this reason).
    """

    embedding_model: str
    backend: IndexBackend
    index_name: str
    namespace: str | None
    dimension: int | None


def _resolve_node_config(
    definition: PipelineDefinition,
    node_type: str,
    model: type[ConfigModel],
) -> ConfigModel:
    """Return a validated config model for the first matching node type."""
    node = next((candidate for candidate in definition.nodes if candidate.type == node_type), None)
    return model.model_validate(node.config if node else {})


def _fixed_chunker_classes(
    registry: NodeRegistry,
) -> list[type[BaseChunkerNode[FixedChunkerConfig]]]:
    """Return the registry's fixed-strategy chunker node classes.

    `ChunkerNode` (the configurable-strategy variant) is excluded here --
    `_resolve_chunker_config` falls back to it separately via
    `_resolve_node_config`.
    """
    classes: list[type[BaseChunkerNode[FixedChunkerConfig]]] = []
    for node_type in registry.node_types():
        node_cls = registry.get_node_class(node_type)
        if node_cls is None or node_cls is ChunkerNode:
            continue
        if issubclass(node_cls, BaseChunkerNode):
            classes.append(node_cls)
    return classes


def _resolve_chunker_config(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> ChunkerConfig:
    """Resolve chunking config from whichever chunker node is present."""
    for node_cls in _fixed_chunker_classes(registry):
        for candidate in definition.nodes:
            if candidate.type == node_cls.type:
                config = FixedChunkerConfig.model_validate(candidate.config)
                return ChunkerConfig(
                    strategy=node_cls.strategy,
                    chunk_size=config.chunk_size,
                    chunk_overlap=config.chunk_overlap,
                )
    return _resolve_node_config(definition, ChunkerNode.type, ChunkerConfig)


def _resolve_backend_node_config(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    base_class: type[BaseIndexerNode] | type[BaseRetrieverNode],
) -> tuple[IndexBackend, BaseModel]:
    """Resolve `(backend, config)` from the definition's indexer/retriever node.

    Walks the definition's nodes and matches whichever registered class
    subclasses `base_class` -- the unified `*.vector` node carries its backend
    in config, legacy backend-pinned variants on the class -- and asks the
    class via `resolve_backend`. When the definition has no matching node at
    all, falls back to the unified node's config defaults on the app-config
    default backend.
    """
    for candidate in definition.nodes:
        node_cls = registry.get_node_class(candidate.type)
        if node_cls is None or not issubclass(node_cls, base_class):
            continue
        # The two issubclass branches are how mypy correlates each base's
        # config model with its `resolve_backend` signature.
        if issubclass(node_cls, BaseIndexerNode):
            indexer_config = node_cls.config_model.model_validate(candidate.config or {})
            return node_cls.resolve_backend(indexer_config), indexer_config
        if issubclass(node_cls, BaseRetrieverNode):
            retriever_config = node_cls.config_model.model_validate(candidate.config or {})
            return node_cls.resolve_backend(retriever_config), retriever_config
    default_backend = IndexBackend(get_app_config().indexing.default_backend)
    fallback_cls = VectorIndexerNode if base_class is BaseIndexerNode else VectorRetrieverNode
    return default_backend, fallback_cls.config_model.model_validate(
        {"backend": default_backend.value, "index_name": default_index_name(default_backend)}
    )


def resolve_definition_backend(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    kind: models.PipelineKind,
) -> IndexBackend:
    """Return the vector-store backend a pipeline definition indexes/queries.

    Falls back to the configured default backend when the definition has no
    indexer/retriever node (same fallback the settings resolvers use).
    """
    base_class: type[BaseIndexerNode] | type[BaseRetrieverNode] = (
        BaseIndexerNode if kind is models.PipelineKind.INGESTION else BaseRetrieverNode
    )
    backend, _ = _resolve_backend_node_config(definition, registry, base_class)
    return backend


def resolve_ingestion_settings(
    definition: PipelineDefinition,
    collection: models.Collection,
    registry: NodeRegistry,
) -> IngestionPipelineSettings:
    """Resolve ingestion settings from a pipeline definition."""
    chunker = _resolve_chunker_config(definition, registry)
    embedder = _resolve_node_config(definition, EmbedderNode.type, EmbedderConfig)
    backend, indexer_model = _resolve_backend_node_config(definition, registry, BaseIndexerNode)
    indexer = IndexerConfig.model_validate(indexer_model.model_dump())
    index_name = (
        resolve_collection_template(indexer.index_name, collection) or indexer.index_name
    )
    namespace = resolve_collection_template(indexer.namespace, collection)
    return IngestionPipelineSettings(
        chunk_strategy=chunker.strategy,
        chunk_size=chunker.chunk_size,
        chunk_overlap=chunker.chunk_overlap,
        embedding_model=embedder.model_name,
        backend=backend,
        index_name=index_name,
        namespace=namespace,
        dimension=indexer.dimension,
        metric=indexer.metric,
    )


def resolve_retrieval_settings(
    definition: PipelineDefinition,
    collection: models.Collection,
    registry: NodeRegistry,
) -> RetrievalPipelineSettings:
    """Resolve retrieval settings from a pipeline definition."""
    backend, retriever_model = _resolve_backend_node_config(definition, registry, BaseRetrieverNode)
    retriever = RetrieverConfig.model_validate(retriever_model.model_dump())
    embedder = _resolve_node_config(definition, EmbedderNode.type, EmbedderConfig)
    index_name = (
        resolve_collection_template(retriever.index_name, collection) or retriever.index_name
    )
    namespace = resolve_collection_template(retriever.namespace, collection)
    return RetrievalPipelineSettings(
        embedding_model=embedder.model_name,
        backend=backend,
        index_name=index_name,
        namespace=namespace,
        dimension=embedder.dimension,
    )


__all__ = [
    "IngestionPipelineSettings",
    "RetrievalPipelineSettings",
    "resolve_definition_backend",
    "resolve_ingestion_settings",
    "resolve_retrieval_settings",
]
