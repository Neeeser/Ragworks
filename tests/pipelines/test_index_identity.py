"""Reading the index identity a definition's nodes carry.

Tested at this layer because the interesting cases (hybrid graphs, pinned
backends, two dense stores, template namespaces) are properties of the
definition alone — no database, and no dependence on whether this machine's
Postgres ships pg_search.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.index_identity import (
    collect_index_identities,
    rewrite_namespace_templates,
    template_to_expression,
)
from app.pipelines.nodes.counting import Bm25FacetNode
from app.pipelines.nodes.indexing import VectorIndexerNode
from app.pipelines.nodes.indexing_bm25 import Bm25IndexerNode
from app.pipelines.nodes.indexing_legacy import PgvectorIndexerNode
from app.pipelines.nodes.retrieval import VectorRetrieverNode
from app.pipelines.registry import default_registry

REGISTRY = default_registry()


def _hybrid_definition() -> PipelineDefinition:
    """A dense indexer plus its BM25 sibling, both with literal identity."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="indexer",
                type=VectorIndexerNode.type,
                name="Indexer",
                config={
                    "backend": "pgvector",
                    "index_name": "docs-main",
                    "namespace": "col-{collection_id}",
                    "dimension": 1536,
                    "metric": "cosine",
                },
            ),
            PipelineNodeDefinition(
                id="bm25",
                type=Bm25IndexerNode.type,
                name="BM25 Indexer",
                config={"backend": "pgvector", "index_name": "docs-main-bm25"},
            ),
        ]
    )


class TestCollectIdentities:
    """Every index a definition names, exactly once each."""

    def test_dense_and_sparse_are_separate_identities(self) -> None:
        identities = collect_index_identities(_hybrid_definition(), REGISTRY)

        assert {(item.name, item.vector_type) for item in identities} == {
            ("docs-main", "dense"),
            ("docs-main-bm25", "sparse"),
        }

    def test_two_dense_stores_stay_two_indexes(self) -> None:
        """A pipeline splitting its corpus keeps both stores.

        Folding every dense node onto one shared index merges two corpora
        into whichever name is read last, and nothing downstream reports it —
        retrieval simply returns the wrong chunks.
        """
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="memories",
                    type=VectorIndexerNode.type,
                    name="Memories",
                    config={
                        "backend": "pgvector",
                        "index_name": "memories",
                        "dimension": 1536,
                    },
                ),
                PipelineNodeDefinition(
                    id="facts",
                    type=VectorIndexerNode.type,
                    name="Facts",
                    config={"backend": "pinecone", "index_name": "facts", "dimension": 768},
                ),
            ]
        )

        identities = collect_index_identities(definition, REGISTRY)

        assert {(item.name, item.backend.value, item.dimension) for item in identities} == {
            ("memories", "pgvector", 1536),
            ("facts", "pinecone", 768),
        }

    def test_one_index_read_and_written_registers_once(self) -> None:
        """A retriever reading what the indexer wrote is one index, not two."""
        definition = PipelineDefinition(
            nodes=[
                *_hybrid_definition().nodes,
                PipelineNodeDefinition(
                    id="retriever",
                    type=VectorRetrieverNode.type,
                    name="Retriever",
                    config={"backend": "pgvector", "index_name": "docs-main"},
                ),
            ]
        )

        identities = collect_index_identities(definition, REGISTRY)

        assert len(identities) == 2
        dense = next(item for item in identities if item.vector_type == "dense")
        # The indexer states the creation parameters; the retriever only reads,
        # so it never blanks what the indexer recorded.
        assert dense.dimension == 1536
        assert dense.metric == "cosine"

    def test_sparse_identity_records_no_dimension(self) -> None:
        """A BM25 index has no vector length; recording one would be a lie."""
        identities = collect_index_identities(_hybrid_definition(), REGISTRY)

        sparse = next(item for item in identities if item.vector_type == "sparse")
        assert sparse.dimension is None

    def test_facet_node_shares_the_sparse_index(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                *_hybrid_definition().nodes,
                PipelineNodeDefinition(
                    id="facet",
                    type=Bm25FacetNode.type,
                    name="Facet",
                    config={"backend": "pgvector", "index_name": "docs-main-bm25"},
                ),
            ]
        )

        identities = collect_index_identities(definition, REGISTRY)

        assert len(identities) == 2

    def test_expression_index_is_not_an_identity(self) -> None:
        """A slot's index is a per-binding answer, not one this graph names."""
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="indexer",
                    type=VectorIndexerNode.type,
                    name="Indexer",
                    config={
                        "backend": {"$expr": "memories_index.backend"},
                        "index_name": {"$expr": "memories_index.name"},
                    },
                ),
            ]
        )

        assert collect_index_identities(definition, REGISTRY) == []

    def test_definition_without_store_nodes_names_nothing(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(id="input", type="ingestion.input", name="In"),
            ]
        )

        assert collect_index_identities(definition, REGISTRY) == []

    def test_node_naming_no_index_names_nothing(self) -> None:
        """A half-configured node registers nothing rather than an empty name.

        An index called "" would be registered, offered in every picker, and
        fail only when a run reaches the store.
        """
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="indexer",
                    type=VectorIndexerNode.type,
                    name="Indexer",
                    config={"backend": "pgvector", "index_name": ""},
                ),
            ]
        )

        assert collect_index_identities(definition, REGISTRY) == []

    def test_unrecognized_backend_names_nothing(self) -> None:
        """A backend this build has no adapter for cannot be registered.

        Registering it would put an index in the picker that no run can open.
        """
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="indexer",
                    type=VectorIndexerNode.type,
                    name="Indexer",
                    config={"backend": "chroma", "index_name": "docs-main"},
                ),
            ]
        )

        assert collect_index_identities(definition, REGISTRY) == []

    def test_a_backend_pinned_node_registers_the_backend_it_is_pinned_to(self) -> None:
        """A legacy indexer names its backend on the class, not in config.

        Node type ids are permanent, so definitions naming `indexer.pgvector`
        stay readable — and their index has to reach the registry, or it is
        unselectable in every picker.
        """
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="indexer",
                    type=PgvectorIndexerNode.type,
                    name="Indexer",
                    config={"index_name": "legacy-docs", "dimension": 384},
                ),
            ]
        )

        identities = collect_index_identities(definition, REGISTRY)

        assert [(i.backend.value, i.name, i.vector_type) for i in identities] == [
            ("pgvector", "legacy-docs", "dense")
        ]


class TestTemplateConversion:
    """`{placeholder}` strings become expressions over the built-ins."""

    def test_namespace_template_converts(self) -> None:
        assert template_to_expression("col-{collection_id}") == "'col-' + collection_id"

    def test_multiple_placeholders_convert(self) -> None:
        assert (
            template_to_expression("{user_id}/{collection_id}")
            == "user_id + '/' + collection_id"
        )

    def test_plain_literal_is_left_alone(self) -> None:
        """No placeholder means no expression — wrapping it would be noise."""
        assert template_to_expression("docs-main") is None

    def test_text_after_the_last_placeholder_survives(self) -> None:
        """A trailing literal is part of the namespace, not decoration."""
        assert (
            template_to_expression("col-{collection_id}-v2") == "'col-' + collection_id + '-v2'"
        )

    def test_a_non_string_namespace_is_left_alone(self) -> None:
        """An expression namespace is already resolved per run, not a template."""
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="indexer",
                    type=VectorIndexerNode.type,
                    name="Indexer",
                    config={
                        "backend": "pgvector",
                        "index_name": "docs-main",
                        "namespace": {"$expr": "collection_id"},
                    },
                ),
            ]
        )

        assert rewrite_namespace_templates(definition) is definition

    def test_converted_namespace_resolves_to_the_same_string(self) -> None:
        rewritten = rewrite_namespace_templates(_hybrid_definition())

        namespace = rewritten.node_map()["indexer"].config["namespace"]
        assert namespace == {"$expr": "'col-' + collection_id"}

    def test_index_names_are_left_literal(self) -> None:
        """Registration makes an index selectable; it never moves the choice."""
        rewritten = rewrite_namespace_templates(_hybrid_definition())

        assert rewritten.node_map()["indexer"].config["index_name"] == "docs-main"
        assert rewritten.node_map()["indexer"].config["backend"] == "pgvector"

    def test_definition_without_templates_is_returned_unchanged(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="indexer",
                    type=VectorIndexerNode.type,
                    name="Indexer",
                    config={"backend": "pgvector", "index_name": "docs-main"},
                ),
            ]
        )

        assert rewrite_namespace_templates(definition) is definition
