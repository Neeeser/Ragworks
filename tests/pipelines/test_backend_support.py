"""Capability checking for the backend a graph's indexes are on.

A node names its own index, so "can this graph run?" is a property of the
definition — the same answer for every collection. These tests pin what the
user is told: the offending nodes by name, not a bare "incompatible backend"
that leaves them guessing which of a dozen nodes to change.
"""

from __future__ import annotations

from app.pipelines.backend_support import incompatible_nodes
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.counting import Bm25FacetNode
from app.pipelines.nodes.retrieval import VectorRetrieverNode
from app.pipelines.registry import default_registry
from app.schemas.enums import IndexBackend

REGISTRY = default_registry()


def _facet_definition(backend: str = "pgvector") -> PipelineDefinition:
    """A graph containing a ParadeDB-only facet node naming its own index."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="facet",
                type=Bm25FacetNode.type,
                name="Facet",
                config={
                    "backend": backend,
                    "index_name": "docs-bm25",
                    "field": "document_id",
                },
            )
        ]
    )


class TestIncompatibleNodes:
    """Which nodes cannot run against the backend they resolved to."""

    def test_facet_on_pgvector_is_fine(self) -> None:
        resolved = _facet_definition("pgvector")

        assert incompatible_nodes(resolved, REGISTRY) == []

    def test_facet_on_pinecone_is_reported_by_node(self) -> None:
        """Pinecone has no query-conditioned aggregation, so facet cannot run."""
        resolved = _facet_definition("pinecone")

        findings = incompatible_nodes(resolved, REGISTRY)

        assert [finding.node_id for finding in findings] == ["facet"]
        assert findings[0].backend is IndexBackend.PINECONE
        assert IndexBackend.PGVECTOR in findings[0].supported

    def test_the_message_names_the_node_and_what_would_work(self) -> None:
        resolved = _facet_definition("pinecone")

        message = incompatible_nodes(resolved, REGISTRY)[0].message

        assert "facet" in message
        assert "pinecone" in message
        assert "pgvector" in message

    def test_a_store_agnostic_node_is_never_flagged(self) -> None:
        definition = PipelineDefinition(
            nodes=[PipelineNodeDefinition(id="in", type="retrieval.input", name="In")]
        )

        assert incompatible_nodes(definition, REGISTRY) == []

    def test_a_plain_retriever_runs_on_either_backend(self) -> None:
        """Only capability-gated nodes restrict the backend."""
        for backend in ("pgvector", "pinecone"):
            definition = PipelineDefinition(
                nodes=[
                    PipelineNodeDefinition(
                        id="retriever",
                        type=VectorRetrieverNode.type,
                        name="Retriever",
                        config={"backend": backend, "index_name": "docs"},
                    )
                ]
            )

            assert incompatible_nodes(definition, REGISTRY) == []


class TestValidationGate:
    """The findings reach pipeline validation, so a save is refused."""

    def test_a_facet_graph_on_pinecone_fails_validation(self) -> None:
        """Checked at save because a node names its own index.

        The graph is wrong for every collection that could bind it, so
        catching it per binding would be catching it too late — and too
        often.
        """
        from app.pipelines.validation import PipelineValidator

        result = PipelineValidator(REGISTRY).validate(_facet_definition("pinecone"))

        assert result.valid is False
        message = " ".join(result.errors)
        assert "facet" in message
        assert "pinecone" in message

    def test_the_same_graph_on_pgvector_passes(self) -> None:
        from app.pipelines.validation import PipelineValidator

        issues = PipelineValidator(REGISTRY).validate(_facet_definition("pgvector")).issues

        assert [issue for issue in issues if issue.code == "backend_unsupported"] == []
