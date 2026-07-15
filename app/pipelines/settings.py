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
from uuid import UUID

from pydantic import BaseModel

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
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
from app.pipelines.nodes.tokenizers import BaseTokenizerNode
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.registry import NodeRegistry
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
class IngestionPipelineSettings:  # pylint: disable=too-many-instance-attributes
    """Resolved settings for ingestion pipelines.

    `backend`/`index_name`/`dimension`/`metric` describe the dense (semantic)
    path — the fallback default when the definition has no indexer at all —
    while `index_targets` lists every index actually present, including the
    BM25 sibling when a `indexer.bm25` node exists.
    """

    chunk_strategy: models.ChunkStrategy
    chunk_size: int
    chunk_overlap: int
    tokenizer: TokenizerSpec
    embedding_model: str
    backend: IndexBackend
    index_name: str
    namespace: str | None
    dimension: int | None
    metric: str
    embedding_connection_id: UUID | None = None
    index_targets: tuple[IndexTarget, ...] = ()

    def __post_init__(self) -> None:
        """Default the targets to the dense primary so they are never empty."""
        _default_dense_targets(self)


@dataclass(frozen=True)
class RetrievalPipelineSettings:
    """Resolved settings for retrieval pipelines.

    Chat model and context window deliberately live outside the pipeline --
    they are session-level choices made in the chat UI, not retrieval
    behavior (the old `chat.settings` node was removed for this reason).
    `index_targets` mirrors the ingestion shape: every index the pipeline
    queries, dense and sparse.
    """

    embedding_model: str
    backend: IndexBackend
    index_name: str
    namespace: str | None
    dimension: int | None
    embedding_connection_id: UUID | None = None
    index_targets: tuple[IndexTarget, ...] = ()

    def __post_init__(self) -> None:
        """Default the targets to the dense primary so they are never empty."""
        _default_dense_targets(self)


def _default_dense_targets(settings: IngestionPipelineSettings | RetrievalPipelineSettings) -> None:
    """Fill empty `index_targets` with the dense primary (legacy definitions)."""
    if not settings.index_targets:
        object.__setattr__(
            settings,
            "index_targets",
            (
                IndexTarget(
                    backend=settings.backend,
                    index_name=settings.index_name,
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
) -> tuple[ChunkerConfig, PipelineNodeDefinition | None]:
    """Resolve config and identity from the definition's registered chunker."""
    for candidate in definition.nodes:
        node_cls = registry.get_node_class(candidate.type)
        if node_cls is None or not issubclass(node_cls, BaseChunkerNode):
            continue
        if node_cls is ChunkerNode:
            return ChunkerConfig.model_validate(candidate.config), candidate
        config = FixedChunkerConfig.model_validate(candidate.config)
        return (
            ChunkerConfig(
                strategy=node_cls.strategy,
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
            ),
            candidate,
        )
    return ChunkerConfig(), None


def _resolve_tokenizer_spec(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    chunker: PipelineNodeDefinition | None,
) -> TokenizerSpec:
    """Resolve the tokenizer wired to a chunker, with WordPiece as fallback."""
    if chunker is None:
        return TokenizerSpec(kind="wordpiece")
    tokenizer_port = next(
        port.key for port in BaseChunkerNode.input_ports if port.data_type == "tokenizer"
    )
    tokenizer_output = next(
        port.key for port in BaseTokenizerNode.output_ports if port.data_type == "tokenizer"
    )
    node_map = definition.node_map()
    for edge in definition.incoming_edges().get(chunker.id, []):
        if edge.target_port != tokenizer_port or edge.source_port != tokenizer_output:
            continue
        source = node_map.get(edge.source)
        if source is None:
            continue
        node = registry.create(source)
        if isinstance(node, BaseTokenizerNode):
            return node.tokenizer_spec()
    return TokenizerSpec(kind="wordpiece")


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


def _build_index_targets(
    *,
    dense: IndexTarget,
    dense_found: bool,
    sparse: IndexTarget | None,
) -> tuple[IndexTarget, ...]:
    """List the indexes a pipeline actually touches.

    The dense fallback (no indexer/retriever node at all) still counts as a
    dense target — legacy definitions rely on it — but a pipeline that only
    carries a BM25 node gets no phantom dense target.
    """
    targets: list[IndexTarget] = []
    if dense_found or sparse is None:
        targets.append(dense)
    if sparse is not None:
        targets.append(sparse)
    return tuple(targets)


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
    backend, _, _ = _resolve_backend_node_config(definition, registry, base_class)
    return backend


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


def resolve_ingestion_settings(
    definition: PipelineDefinition,
    collection: models.Collection,
    registry: NodeRegistry,
) -> IngestionPipelineSettings:
    """Resolve ingestion settings from a pipeline definition."""
    chunker, chunker_node = _resolve_chunker_config(definition, registry)
    embedder = _resolve_node_config(definition, EmbedderNode.type, EmbedderConfig)
    backend, indexer_model, dense_found = _resolve_backend_node_config(
        definition, registry, BaseIndexerNode
    )
    indexer = IndexerConfig.model_validate(indexer_model.model_dump())
    index_name = (
        resolve_collection_template(indexer.index_name, collection) or indexer.index_name
    )
    namespace = resolve_collection_template(indexer.namespace, collection)
    bm25 = _resolve_bm25_config(definition, Bm25IndexerNode.type, Bm25IndexerConfig)
    return IngestionPipelineSettings(
        chunk_strategy=chunker.strategy,
        chunk_size=chunker.chunk_size,
        chunk_overlap=chunker.chunk_overlap,
        tokenizer=_resolve_tokenizer_spec(definition, registry, chunker_node),
        embedding_model=embedder.model_name,
        embedding_connection_id=embedder.connection_id,
        backend=backend,
        index_name=index_name,
        namespace=namespace,
        dimension=indexer.dimension,
        metric=indexer.metric,
        index_targets=_build_index_targets(
            dense=IndexTarget(backend=backend, index_name=index_name, vector_type="dense"),
            dense_found=dense_found,
            sparse=_sparse_target(collection, bm25),
        ),
    )


def resolve_retrieval_settings(
    definition: PipelineDefinition,
    collection: models.Collection,
    registry: NodeRegistry,
) -> RetrievalPipelineSettings:
    """Resolve retrieval settings from a pipeline definition."""
    backend, retriever_model, dense_found = _resolve_backend_node_config(
        definition, registry, BaseRetrieverNode
    )
    retriever = RetrieverConfig.model_validate(retriever_model.model_dump())
    embedder = _resolve_node_config(definition, EmbedderNode.type, EmbedderConfig)
    index_name = (
        resolve_collection_template(retriever.index_name, collection) or retriever.index_name
    )
    namespace = resolve_collection_template(retriever.namespace, collection)
    bm25 = _resolve_bm25_config(definition, Bm25RetrieverNode.type, Bm25RetrieverConfig)
    return RetrievalPipelineSettings(
        embedding_model=embedder.model_name,
        embedding_connection_id=embedder.connection_id,
        backend=backend,
        index_name=index_name,
        namespace=namespace,
        dimension=embedder.dimension,
        index_targets=_build_index_targets(
            dense=IndexTarget(backend=backend, index_name=index_name, vector_type="dense"),
            dense_found=dense_found,
            sparse=_sparse_target(collection, bm25),
        ),
    )


__all__ = [
    "IndexTarget",
    "IngestionPipelineSettings",
    "RetrievalPipelineSettings",
    "resolve_definition_backend",
    "resolve_ingestion_settings",
    "resolve_retrieval_settings",
]
