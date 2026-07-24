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

There is one resolver for every pipeline shape: which fields are meaningful
follows from which nodes the graph contains, not from a stored pipeline
kind. `index_targets` is always the union of every index the graph touches
-- indexer and retriever side, dense and sparse -- because purge cascades
iterate targets, and a tool pipeline with an indexer node writes to indexes
the ingest pipeline never touched.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypeVar
from uuid import UUID

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
    Bm25IndexerConfig,
    Bm25IndexerNode,
    IndexerConfig,
    VectorIndexerNode,
    default_index_name,
)
from app.pipelines.nodes.retrieval import (
    BaseRetrieverNode,
    Bm25RetrieverConfig,
    Bm25RetrieverNode,
    RetrieverConfig,
    VectorRetrieverNode,
)
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.registry import NodeRegistry
from app.pipelines.resolution import resolve_static_definition
from app.pipelines.template import resolve_collection_template
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config

ConfigModel = TypeVar("ConfigModel", bound=BaseModel)


@dataclass(frozen=True)
class IndexTarget:
    """One index a pipeline writes to or reads from.

    `vector_type` is "dense" (embedding index) or "sparse" (BM25/lexical).
    Purge cascades iterate a pipeline's targets so deleting a collection or
    document clears every index it touched, not just the dense one.
    """

    backend: IndexBackend
    index_name: str
    vector_type: str


@dataclass(frozen=True)
class PipelineSettings:  # pylint: disable=too-many-instance-attributes
    """Resolved settings for a pipeline, whatever its shape.

    `backend`/`index_name`/`namespace`/`dimension`/`metric` describe the
    primary dense identity — the indexer node's when the graph writes, else
    the retriever node's, else the configured-default fallback legacy
    definitions rely on. Chunker fields resolve to their built-in defaults
    when the graph has no chunker (retrieval-shaped pipelines). Chat model
    and context window deliberately live outside the pipeline — they are
    session-level choices made in the chat UI, not pipeline behavior.
    """

    backend: IndexBackend
    index_name: str
    chunk_strategy: models.ChunkStrategy = models.ChunkStrategy.TOKEN
    chunk_size: int = 512
    chunk_overlap: int = 200
    tokenizer: TokenizerSpec = field(
        default_factory=lambda: TokenizerSpec(kind="wordpiece")
    )
    embedding_model: str = ""
    namespace: str | None = None
    dimension: int | None = None
    metric: str = "cosine"
    embedding_connection_id: UUID | None = None
    index_targets: tuple[IndexTarget, ...] = field(default=())

    def __post_init__(self) -> None:
        """Default the targets to the dense primary so they are never empty."""
        if not self.index_targets:
            object.__setattr__(
                self,
                "index_targets",
                (
                    IndexTarget(
                        backend=self.backend,
                        index_name=self.index_name,
                        vector_type="dense",
                    ),
                ),
            )


def _resolve_node_config(
    definition: PipelineDefinition,
    node_type: str,
    model: type[ConfigModel],
) -> ConfigModel:
    """Return a validated config model for the first matching node type."""
    node = next((candidate for candidate in definition.nodes if candidate.type == node_type), None)
    return model.model_validate(node.config if node else {})


def _resolve_chunker_config(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> ChunkerConfig:
    """Resolve config from the definition's registered chunker."""
    for candidate in definition.nodes:
        node_cls = registry.get_node_class(candidate.type)
        if node_cls is None or not issubclass(node_cls, BaseChunkerNode):
            continue
        if node_cls is ChunkerNode:
            return ChunkerConfig.model_validate(candidate.config)
        config = FixedChunkerConfig.model_validate(candidate.config)
        return ChunkerConfig(
            strategy=node_cls.strategy,
            chunk_size=config.chunk_size,
            chunk_overlap=config.chunk_overlap,
            tokenizer=config.tokenizer,
            hf_model_id=config.hf_model_id,
        )
    return ChunkerConfig()


def _resolve_tokenizer_spec(
    config: ChunkerConfig,
) -> TokenizerSpec:
    """Build the ingestion tokenizer spec from the resolved chunker config."""
    return TokenizerSpec(kind=config.tokenizer, hf_model_id=config.hf_model_id)


def _resolve_backend_node_config(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    base_class: type[BaseIndexerNode] | type[BaseRetrieverNode],
) -> tuple[IndexBackend, BaseModel, bool]:
    """Resolve `(backend, config, found)` from the definition's dense node.

    Walks the definition's nodes and matches whichever registered class
    subclasses `base_class` -- the unified `*.vector` node carries its backend
    in config, legacy backend-pinned variants on the class -- and asks the
    class via `resolve_backend`. When the definition has no matching node at
    all, falls back to the unified node's config defaults on the app-config
    default backend (`found=False`).
    """
    for candidate in definition.nodes:
        node_cls = registry.get_node_class(candidate.type)
        if node_cls is None or not issubclass(node_cls, base_class):
            continue
        # The two issubclass branches are how mypy correlates each base's
        # config model with its `resolve_backend` signature.
        if issubclass(node_cls, BaseIndexerNode):
            indexer_config = node_cls.config_model.model_validate(candidate.config or {})
            return node_cls.resolve_backend(indexer_config), indexer_config, True
        if issubclass(node_cls, BaseRetrieverNode):
            retriever_config = node_cls.config_model.model_validate(candidate.config or {})
            return node_cls.resolve_backend(retriever_config), retriever_config, True
    default_backend = IndexBackend(get_app_config().indexing.default_backend)
    fallback_cls = VectorIndexerNode if base_class is BaseIndexerNode else VectorRetrieverNode
    fallback_config = fallback_cls.config_model.model_validate(
        {"backend": default_backend.value, "index_name": default_index_name(default_backend)}
    )
    return default_backend, fallback_config, False


def _resolve_bm25_config(
    definition: PipelineDefinition,
    node_type: str,
    model: type[ConfigModel],
) -> ConfigModel | None:
    """Return the validated BM25 node config, or None when absent."""
    node = next((candidate for candidate in definition.nodes if candidate.type == node_type), None)
    if node is None:
        return None
    return model.model_validate(node.config or {})


def resolve_definition_backend(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> IndexBackend:
    """Return the vector-store backend a pipeline definition indexes/queries.

    Prefers the indexer node's backend (the graph writes), then the
    retriever's (it only reads), then the configured default — the same
    precedence the settings resolver gives the primary identity.
    """
    static = resolve_static_definition(definition)
    backend, _, indexer_found = _resolve_backend_node_config(static, registry, BaseIndexerNode)
    if indexer_found:
        return backend
    retriever_backend, _, retriever_found = _resolve_backend_node_config(
        static, registry, BaseRetrieverNode
    )
    return retriever_backend if retriever_found else backend


def _sparse_target(
    collection: models.Collection,
    config: Bm25IndexerConfig | Bm25RetrieverConfig | None,
) -> IndexTarget | None:
    """Build the sparse index target for a BM25 node config, if present."""
    if config is None:
        return None
    index_name = (
        resolve_collection_template(config.index_name, collection) or config.index_name
    )
    return IndexTarget(backend=config.backend, index_name=index_name, vector_type="sparse")


def _dense_target(
    collection: models.Collection,
    backend: IndexBackend,
    config: IndexerConfig | RetrieverConfig,
) -> IndexTarget:
    """Build the dense index target for an indexer/retriever config."""
    index_name = (
        resolve_collection_template(config.index_name, collection) or config.index_name
    )
    return IndexTarget(backend=backend, index_name=index_name, vector_type="dense")


def _union_targets(*candidates: IndexTarget | None) -> tuple[IndexTarget, ...]:
    """Dedupe targets by identity, preserving first-seen order."""
    targets: list[IndexTarget] = []
    seen: set[IndexTarget] = set()
    for candidate in candidates:
        if candidate is None or candidate in seen:
            continue
        seen.add(candidate)
        targets.append(candidate)
    return tuple(targets)


def resolve_pipeline_settings(  # pylint: disable=too-many-locals
    definition: PipelineDefinition,
    collection: models.Collection,
    registry: NodeRegistry,
) -> PipelineSettings:
    """Resolve settings from any pipeline definition.

    Expressions resolve against the static default environment first — the
    taint rule guarantees identity fields never depend on runtime input, so
    the static view is the authoritative one for index targets and purges.
    """
    definition = resolve_static_definition(definition)
    chunker = _resolve_chunker_config(definition, registry)
    embedder = _resolve_node_config(definition, EmbedderNode.type, EmbedderConfig)
    indexer_backend, indexer_model, indexer_found = _resolve_backend_node_config(
        definition, registry, BaseIndexerNode
    )
    retriever_backend, retriever_model, retriever_found = _resolve_backend_node_config(
        definition, registry, BaseRetrieverNode
    )
    indexer = IndexerConfig.model_validate(indexer_model.model_dump())
    retriever = RetrieverConfig.model_validate(retriever_model.model_dump())

    if indexer_found or not retriever_found:
        primary_backend = indexer_backend
        primary_name = (
            resolve_collection_template(indexer.index_name, collection) or indexer.index_name
        )
        primary_namespace = resolve_collection_template(indexer.namespace, collection)
        dimension = indexer.dimension if indexer_found else embedder.dimension
    else:
        primary_backend = retriever_backend
        primary_name = (
            resolve_collection_template(retriever.index_name, collection)
            or retriever.index_name
        )
        primary_namespace = resolve_collection_template(retriever.namespace, collection)
        dimension = embedder.dimension

    dense_targets: list[IndexTarget | None] = []
    if indexer_found:
        dense_targets.append(_dense_target(collection, indexer_backend, indexer))
    if retriever_found:
        dense_targets.append(_dense_target(collection, retriever_backend, retriever))
    if not indexer_found and not retriever_found:
        # Legacy fallback: no dense node at all still counts as one dense
        # target on the configured default — unless the graph is sparse-only.
        dense_targets.append(
            IndexTarget(backend=primary_backend, index_name=primary_name, vector_type="dense")
        )

    sparse_ingest = _sparse_target(
        collection, _resolve_bm25_config(definition, Bm25IndexerNode.type, Bm25IndexerConfig)
    )
    sparse_query = _sparse_target(
        collection, _resolve_bm25_config(definition, Bm25RetrieverNode.type, Bm25RetrieverConfig)
    )
    if not indexer_found and not retriever_found and (sparse_ingest or sparse_query):
        # A sparse-only graph gets no phantom dense target.
        dense_targets = []

    return PipelineSettings(
        chunk_strategy=chunker.strategy,
        chunk_size=chunker.chunk_size,
        chunk_overlap=chunker.chunk_overlap,
        tokenizer=_resolve_tokenizer_spec(chunker),
        embedding_model=embedder.model_name,
        embedding_connection_id=embedder.connection_id,
        backend=primary_backend,
        index_name=primary_name,
        namespace=primary_namespace,
        dimension=dimension,
        metric=indexer.metric,
        index_targets=_union_targets(*dense_targets, sparse_ingest, sparse_query),
    )


__all__ = [
    "IndexTarget",
    "PipelineSettings",
    "resolve_definition_backend",
    "resolve_pipeline_settings",
]
