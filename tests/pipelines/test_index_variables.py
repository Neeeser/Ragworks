"""The pure literal-identity -> index-variable rewrite.

Tested at this layer because the interesting cases (hybrid graphs, pinned
backends, template namespaces) are properties of the definition alone — no
database, and no dependence on whether this machine's Postgres ships
pg_search.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.index_variables import (
    rewrite_index_identity,
    template_to_expression,
)
from app.pipelines.nodes.counting import Bm25FacetNode
from app.pipelines.nodes.indexing import Bm25IndexerNode, VectorIndexerNode
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_static_definition
from app.pipelines.variables import VariableSource, VariableType

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


class TestRewrite:
    """Literal identity moves onto variables without changing what resolves."""

    def test_dense_and_sparse_get_separate_variables(self) -> None:
        rewritten = rewrite_index_identity(_hybrid_definition(), REGISTRY)

        variables = {
            variable.name: variable
            for variable in rewritten.definition.variables
            if variable.type is VariableType.INDEX
        }
        assert set(variables) == {"primary_index", "bm25_index"}
        assert all(
            variable.source is VariableSource.BINDING for variable in variables.values()
        )

    def test_resolved_names_are_unchanged(self) -> None:
        """The rewrite is behavior-preserving: same names, same backends."""
        rewritten = rewrite_index_identity(_hybrid_definition(), REGISTRY)

        resolved = resolve_static_definition(rewritten.definition)
        nodes = resolved.node_map()
        assert nodes["indexer"].config["index_name"] == "docs-main"
        assert nodes["indexer"].config["backend"] == "pgvector"
        assert nodes["bm25"].config["index_name"] == "docs-main-bm25"

    def test_sparse_identity_records_no_dimension(self) -> None:
        """A BM25 index has no vector length; recording one would be a lie."""
        rewritten = rewrite_index_identity(_hybrid_definition(), REGISTRY)

        assert rewritten.identities["bm25_index"].vector_type == "sparse"
        assert rewritten.identities["bm25_index"].dimension is None
        assert rewritten.identities["primary_index"].dimension == 1536

    def test_facet_node_shares_the_sparse_variable(self) -> None:
        """Every lexical node reads one sparse index, not one variable each."""
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

        rewritten = rewrite_index_identity(definition, REGISTRY)

        index_variables = [
            variable
            for variable in rewritten.definition.variables
            if variable.type is VariableType.INDEX
        ]
        assert len(index_variables) == 2
        facet = rewritten.definition.node_map()["facet"]
        assert facet.config["index_name"] == {"$expr": "bm25_index.name"}

    def test_definition_without_store_nodes_is_untouched(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(id="input", type="ingestion.input", name="In"),
            ]
        )

        rewritten = rewrite_index_identity(definition, REGISTRY)

        assert rewritten.changed is False
        assert rewritten.definition is definition

    def test_rerunning_the_rewrite_adds_no_second_variable(self) -> None:
        once = rewrite_index_identity(_hybrid_definition(), REGISTRY)

        twice = rewrite_index_identity(once.definition, REGISTRY)

        assert twice.changed is False


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

    def test_converted_namespace_resolves_to_the_same_string(self) -> None:
        rewritten = rewrite_index_identity(_hybrid_definition(), REGISTRY)

        namespace = rewritten.definition.node_map()["indexer"].config["namespace"]
        assert namespace == {"$expr": "'col-' + collection_id"}
