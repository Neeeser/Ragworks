"""Every shipped tool template builds a graph the validator accepts.

The create-pipeline wizard renders this catalog and scaffolds through it, so a
template that names a port the node registry does not declare, or leaves a node
its own validator refuses, is a pipeline nobody can create.
"""

from __future__ import annotations

from uuid import UUID

import pytest

from app.pipelines.index_identity import collect_index_identities
from app.pipelines.registry import default_registry
from app.pipelines.tool_defaults import TOOL_TEMPLATES, ToolTemplate, ToolTemplateChoices
from app.pipelines.validation import PipelineValidator
from app.schemas.enums import IndexBackend

CHOICES = ToolTemplateChoices(
    backend=IndexBackend.PGVECTOR,
    index_name="ragworks",
    embedding_connection_id=UUID("00000000-0000-0000-0000-000000000001"),
    embedding_model="openai/text-embedding-3-small",
    reranking_connection_id=UUID("00000000-0000-0000-0000-000000000001"),
    reranking_model="cohere/rerank-v3.5",
)


@pytest.mark.parametrize("template", TOOL_TEMPLATES, ids=lambda entry: entry.id)
def test_shipped_template_passes_validation(template: ToolTemplate) -> None:
    """A template the wizard offers must produce a creatable pipeline."""
    result = PipelineValidator(default_registry()).validate(template.build(CHOICES))

    errors = [issue.message for issue in result.issues if issue.severity == "error"]
    assert result.errors == [], f"{template.id}: {result.errors}"
    assert errors == [], f"{template.id}: {errors}"


@pytest.mark.parametrize("template", TOOL_TEMPLATES, ids=lambda entry: entry.id)
def test_shipped_template_edges_name_declared_ports(template: ToolTemplate) -> None:
    """Every edge endpoint is a port its node actually declares.

    The wizard's own drift was here: an edge naming `results`/`request` on
    nodes whose ports are `items` builds fine and fails only on Create.
    """
    definition = template.build(CHOICES)
    registry = default_registry()
    classes = {node.id: registry.get_node_class(node.type) for node in definition.nodes}

    for edge in definition.edges:
        source = classes[edge.source]
        target = classes[edge.target]
        assert source is not None
        assert target is not None
        outputs = {port.key for port in source.output_ports}
        inputs = {port.key for port in target.input_ports}
        assert edge.source_port in outputs, f"{template.id}/{edge.id}: {edge.source_port}"
        assert edge.target_port in inputs, f"{template.id}/{edge.id}: {edge.target_port}"


def test_catalog_covers_every_offered_starting_point() -> None:
    """The catalog is the wizard's whole menu — nothing escapes the guard."""
    assert [template.id for template in TOOL_TEMPLATES] == [
        "semantic-keyword",
        "reranked",
        "count",
        "facet",
        "blank",
    ]


@pytest.mark.parametrize("template", TOOL_TEMPLATES, ids=lambda entry: entry.id)
def test_declared_index_kind_matches_the_index_the_graph_names(
    template: ToolTemplate,
) -> None:
    """`index_vector_type` is the index the wizard collects, so the graph has
    to name one of that kind: offering a dense index to a BM25-only tool asks
    for a store the definition never reads. A hybrid template names a sparse
    sibling too, derived from the dense name it is given."""
    registry = default_registry()
    identities = collect_index_identities(template.build(CHOICES), registry)
    kinds = {identity.vector_type for identity in identities}

    if template.index_vector_type is None:
        assert identities == []
        assert template.needs_store is False
        return
    assert template.needs_store is True
    assert template.index_vector_type in kinds
    if template.index_vector_type == "sparse":
        assert kinds == {"sparse"}
