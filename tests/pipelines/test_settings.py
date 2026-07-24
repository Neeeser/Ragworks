"""Unified pipeline settings resolution.

One resolver serves every pipeline shape: chunker/embedder/indexer fields
resolve when their nodes are present, and `index_targets` is the union of
every index the graph touches — indexer AND retriever side, dense and sparse
— because purges iterate targets and a tool pipeline with an indexer node
writes to indexes the ingest pipeline never touched.
"""

from __future__ import annotations

from uuid import uuid4

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.registry import default_registry
from app.pipelines.settings import resolve_pipeline_settings
from app.pipelines.template import resolve_collection_template
from app.schemas.enums import IndexBackend


def _collection() -> models.Collection:
    return models.Collection(
        id=uuid4(),
        user_id=uuid4(),
        name="Test Collection",
        description="",
        extra_metadata={},
    )


def _node(node_id: str, node_type: str, config: dict[str, object]) -> PipelineNodeDefinition:
    return PipelineNodeDefinition(id=node_id, type=node_type, name=node_id, config=config)


def test_resolve_collection_template_accepts_none() -> None:
    collection = _collection()

    assert resolve_collection_template(None, collection) is None


def test_resolve_collection_template_replaces_placeholders() -> None:
    """Every placeholder resolve_collection_template documents gets substituted."""
    collection = _collection()

    rendered = resolve_collection_template(
        "col-{collection_id}-{collection_name}-{user_id}",
        collection,
    )

    assert rendered == f"col-{collection.id}-{collection.name}-{collection.user_id}"


def test_settings_fall_back_to_configurable_chunker_when_no_fixed_node() -> None:
    """With no chunker node at all, the literal built-in default applies
    (token/512/200) — pinned as literals rather than re-derived from
    `ChunkerConfig()`, which would just prove two reads of one default agree.
    """
    definition = PipelineDefinition(nodes=[], edges=[])
    collection = _collection()

    settings = resolve_pipeline_settings(definition, collection, default_registry())

    assert settings.chunk_strategy == models.ChunkStrategy.TOKEN
    assert settings.chunk_size == 512
    assert settings.chunk_overlap == 200
    assert settings.tokenizer == TokenizerSpec(kind="wordpiece")


def test_settings_use_fixed_strategy_chunker_config() -> None:
    """A fixed-strategy chunker node drives strategy/size/overlap from ITS OWN
    config — the registry-walk in `_resolve_chunker_config` reads
    `type`/`strategy` off the node class, never a hardcoded table.
    """
    definition = PipelineDefinition(
        nodes=[
            _node("chunker-1", "chunker.sentence", {"chunk_size": 777, "chunk_overlap": 111}),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert settings.chunk_strategy == models.ChunkStrategy.SENTENCE
    assert settings.chunk_size == 777
    assert settings.chunk_overlap == 111


def test_settings_use_chunker_tokenizer_config() -> None:
    definition = PipelineDefinition(
        nodes=[_node("chunker-1", "chunker.token", {"tokenizer": "whitespace"})],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert settings.tokenizer == TokenizerSpec(kind="whitespace")


def test_indexer_drives_primary_index_identity() -> None:
    """An indexer node's config is the primary identity (backend, index,
    namespace, dimension, metric), with collection templates resolved."""
    collection = _collection()
    definition = PipelineDefinition(
        nodes=[
            _node(
                "indexer-1",
                "indexer.vector",
                {
                    "backend": "pgvector",
                    "index_name": "docs-dense",
                    "namespace": "collection-{collection_id}",
                    "dimension": 1536,
                    "metric": "cosine",
                },
            ),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, collection, default_registry())

    assert settings.backend is IndexBackend.PGVECTOR
    assert settings.index_name == "docs-dense"
    assert settings.namespace == f"collection-{collection.id}"
    assert settings.dimension == 1536
    assert settings.metric == "cosine"
    assert [
        (target.backend, target.index_name, target.vector_type)
        for target in settings.index_targets
    ] == [(IndexBackend.PGVECTOR, "docs-dense", "dense")]


def test_retriever_only_pipeline_reads_dimension_from_embedder() -> None:
    definition = PipelineDefinition(
        nodes=[
            _node(
                "embedder-1",
                "embedder.text",
                {"model_name": "text-embedding-3-small", "dimension": 768},
            ),
            _node(
                "retriever-1",
                "retriever.vector",
                {"backend": "pgvector", "index_name": "docs-dense"},
            ),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert settings.backend is IndexBackend.PGVECTOR
    assert settings.index_name == "docs-dense"
    assert settings.dimension == 768
    assert settings.embedding_model == "text-embedding-3-small"


def test_index_targets_union_indexer_and_retriever_sides() -> None:
    """A graph that writes one index and reads another lists BOTH as targets —
    the purge contract depends on the union, not the primary side alone."""
    definition = PipelineDefinition(
        nodes=[
            _node(
                "retriever-1",
                "retriever.vector",
                {"backend": "pgvector", "index_name": "docs-dense"},
            ),
            _node(
                "indexer-1",
                "indexer.vector",
                {"backend": "pgvector", "index_name": "agent-memory", "dimension": 768},
            ),
            _node(
                "bm25-retriever",
                "retriever.bm25",
                {"backend": "pgvector", "index_name": "docs-dense-bm25"},
            ),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert {
        (target.index_name, target.vector_type) for target in settings.index_targets
    } == {
        ("agent-memory", "dense"),
        ("docs-dense", "dense"),
        ("docs-dense-bm25", "sparse"),
    }


def test_index_targets_dedupe_shared_identity() -> None:
    """An indexer and retriever naming the same index yield one target."""
    definition = PipelineDefinition(
        nodes=[
            _node(
                "indexer-1",
                "indexer.vector",
                {"backend": "pgvector", "index_name": "docs-dense", "dimension": 768},
            ),
            _node(
                "retriever-1",
                "retriever.vector",
                {"backend": "pgvector", "index_name": "docs-dense"},
            ),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert [
        (target.index_name, target.vector_type) for target in settings.index_targets
    ] == [("docs-dense", "dense")]


def test_facet_node_registers_its_sparse_index_target() -> None:
    """Facet-only tools mirror the count rule: purge coverage and prereq
    checks iterate index_targets, so the read target must be visible."""
    definition = PipelineDefinition(
        nodes=[
            _node(
                "facet-1",
                "facet.bm25",
                {"backend": "pgvector", "index_name": "docs-dense-bm25"},
            ),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert {
        (target.index_name, target.vector_type) for target in settings.index_targets
    } == {("docs-dense-bm25", "sparse")}


def test_count_node_registers_its_sparse_index_target() -> None:
    """A count-only tool still lists its BM25 index in index_targets — the
    Pinecone-prereq check and diagnostics iterate targets, and a target the
    graph reads must be visible to them."""
    definition = PipelineDefinition(
        nodes=[
            _node(
                "count-1",
                "count.bm25",
                {"backend": "pgvector", "index_name": "docs-dense-bm25"},
            ),
        ],
        edges=[],
    )

    settings = resolve_pipeline_settings(definition, _collection(), default_registry())

    assert {
        (target.index_name, target.vector_type) for target in settings.index_targets
    } == {("docs-dense-bm25", "sparse")}
