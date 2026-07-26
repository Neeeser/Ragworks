"""Which indexes a pipeline graph touches.

Purge cascades iterate a pipeline's targets, so this list is what makes
deleting a collection or a document clear every index the graph wrote to.
It covers both planes (dense and sparse) and both sides (indexer and
retriever), and it lists *every* dense store rather than the primary one:
a graph may deliberately split its corpus across several indexes, and a
store missing from this list keeps its vectors after a delete and re-serves
them on the next query.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel

from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.pipelines.nodes.counting import (
    Bm25CountConfig,
    Bm25CountNode,
    Bm25FacetConfig,
    Bm25FacetNode,
)
from app.pipelines.nodes.indexing import (
    BaseIndexerNode,
    Bm25IndexerConfig,
    Bm25IndexerNode,
    IndexerConfig,
)
from app.pipelines.nodes.retrieval import (
    BaseRetrieverNode,
    Bm25RetrieverConfig,
    Bm25RetrieverNode,
    RetrieverConfig,
)
from app.pipelines.registry import NodeRegistry
from app.pipelines.template import resolve_collection_template
from app.schemas.enums import IndexBackend

ConfigModel = TypeVar("ConfigModel", bound=BaseModel)


@dataclass(frozen=True)
class IndexTarget:
    """One index a pipeline writes to or reads from.

    `vector_type` is "dense" (embedding index) or "sparse" (BM25/lexical).
    """

    backend: IndexBackend
    index_name: str
    vector_type: str


def dense_targets(
    definition: PipelineDefinition,
    collection: models.Collection,
    registry: NodeRegistry,
) -> list[IndexTarget]:
    """Every dense index the graph stores in or reads from."""
    targets: list[IndexTarget] = []
    for node in definition.nodes:
        node_cls = registry.get_node_class(node.type)
        if node_cls is None:
            continue
        # The two issubclass branches are how mypy correlates each base's
        # config model with its `resolve_backend` signature.
        if issubclass(node_cls, BaseIndexerNode):
            indexer = node_cls.config_model.model_validate(node.config or {})
            targets.append(
                _dense_target(
                    collection,
                    node_cls.resolve_backend(indexer),
                    IndexerConfig.model_validate(indexer.model_dump()),
                )
            )
        elif issubclass(node_cls, BaseRetrieverNode):
            retriever = node_cls.config_model.model_validate(node.config or {})
            targets.append(
                _dense_target(
                    collection,
                    node_cls.resolve_backend(retriever),
                    RetrieverConfig.model_validate(retriever.model_dump()),
                )
            )
    return targets


def sparse_targets(
    definition: PipelineDefinition,
    collection: models.Collection,
) -> list[IndexTarget | None]:
    """Every lexical index the graph indexes, queries, counts, or facets."""
    return [
        _sparse_target(
            collection, _resolve_bm25_config(definition, Bm25IndexerNode.type, Bm25IndexerConfig)
        ),
        _sparse_target(
            collection,
            _resolve_bm25_config(definition, Bm25RetrieverNode.type, Bm25RetrieverConfig),
        ),
        _sparse_target(
            collection, _resolve_bm25_config(definition, Bm25CountNode.type, Bm25CountConfig)
        ),
        _sparse_target(
            collection, _resolve_bm25_config(definition, Bm25FacetNode.type, Bm25FacetConfig)
        ),
    ]


def union_targets(*candidates: IndexTarget | None) -> tuple[IndexTarget, ...]:
    """Dedupe targets by identity, preserving first-seen order."""
    targets: list[IndexTarget] = []
    seen: set[IndexTarget] = set()
    for candidate in candidates:
        if candidate is None or candidate in seen:
            continue
        seen.add(candidate)
        targets.append(candidate)
    return tuple(targets)


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


def _sparse_target(
    collection: models.Collection,
    config: Bm25CountConfig | Bm25FacetConfig | Bm25IndexerConfig | Bm25RetrieverConfig | None,
) -> IndexTarget | None:
    """Build the sparse index target for a BM25 node config."""
    if config is None:
        return None
    index_name = (
        resolve_collection_template(config.index_name, collection) or config.index_name
    )
    return IndexTarget(backend=config.backend, index_name=index_name, vector_type="sparse")


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
