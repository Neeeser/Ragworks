"""Facet inference: the shared vectors plus engine-level integration checks.

The vectors in `tests/assets/facet_vectors.json` are executed by this module
and by the frontend's vitest suite against its mirrored implementation —
they are what keep the two facet-inference implementations from drifting.
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest

from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.facets import EdgeRef, NodePorts, facet_issues, infer_port_facets
from app.pipelines.modality import modality_issues
from app.pipelines.ports import NodePort
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator

VECTORS = json.loads(
    (Path(__file__).parent.parent / "assets" / "facet_vectors.json").read_text()
)


def _node_ports(raw: dict[str, dict[str, list[dict[str, object]]]]) -> NodePorts:
    return {
        node_id: (
            [NodePort.model_validate({"label": port["key"], **port}) for port in decl["inputs"]],
            [NodePort.model_validate({"label": port["key"], **port}) for port in decl["outputs"]],
        )
        for node_id, decl in raw.items()
    }


def _edges(raw: list[dict[str, str]]) -> list[EdgeRef]:
    return [
        EdgeRef(
            id=edge["id"],
            source=edge["source"],
            source_port=edge.get("source_port"),
            target=edge["target"],
            target_port=edge.get("target_port"),
        )
        for edge in raw
    ]


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda case: case["name"])
def test_shared_vectors(case: dict[str, object]) -> None:
    node_ports = _node_ports(case["nodes"])
    edges = _edges(case["edges"])

    inferred = infer_port_facets(node_ports, edges)
    assert _by_port(inferred.guarantees) == case["guarantees"]
    assert _by_port(inferred.potentials) == case["potentials"]

    issues = facet_issues(node_ports, edges)
    assert [
        {"edge_id": issue.edge_id, "missing": list(issue.missing)} for issue in issues
    ] == case["issues"]

    findings = sorted(
        (
            {
                "kind": issue.kind,
                "node_id": issue.node_id,
                "modality": str(issue.modality),
                "severity": issue.severity,
            }
            for issue in modality_issues(node_ports, edges)
        ),
        key=lambda finding: (finding["kind"], finding["node_id"]),
    )
    assert findings == case["modality"]


def _by_port(facets: dict[tuple[str, str], frozenset[str]]) -> dict[str, list[str]]:
    return {f"{node_id}.{port_key}": sorted(values) for (node_id, port_key), values in facets.items()}


def _registry_definition(
    nodes: list[PipelineNodeDefinition], edges: list[PipelineEdgeDefinition]
) -> PipelineDefinition:
    return PipelineDefinition(nodes=nodes, edges=edges)


def test_default_pipelines_pass_facet_validation() -> None:
    """The scaffolded hybrid defaults are facet-sound end to end."""
    validator = PipelineValidator(default_registry())
    for definition in (
        build_default_ingestion_pipeline(
            embedding_connection_id=uuid4(), embedding_model="test-embed"
        ),
        build_default_retrieval_pipeline(
            embedding_connection_id=uuid4(), embedding_model="test-embed"
        ),
    ):
        result = validator.validate(definition)
        assert not [error for error in result.errors if "delivers items" in error], result.errors


def test_validator_rejects_query_stream_into_dense_retriever() -> None:
    """A text-only stream wired straight into an embedding-requiring retriever
    is the canonical nonsense edge the facet system exists to reject."""
    definition = _registry_definition(
        nodes=[
            PipelineNodeDefinition(id="input", type="retrieval.input", name="Input"),
            PipelineNodeDefinition(
                id="retrieve",
                type="retriever.vector",
                name="Retriever",
                config={"backend": "pgvector", "index_name": "docs", "top_k": 5},
            ),
            PipelineNodeDefinition(id="out", type="retrieval.output", name="Out"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1",
                source="input",
                target="retrieve",
                source_port="items",
                target_port="items",
            ),
            PipelineEdgeDefinition(
                id="e2",
                source="retrieve",
                target="out",
                source_port="items",
                target_port="items",
            ),
        ],
    )
    result = PipelineValidator(default_registry()).validate(definition)

    assert result.valid is False
    assert any("delivers items without embedding" in error for error in result.errors)


def test_validator_allows_reembedding_a_result_set() -> None:
    """Results carry text, so wiring them back into an embedder is legal."""
    connection = str(uuid4())
    definition = _registry_definition(
        nodes=[
            PipelineNodeDefinition(id="input", type="retrieval.input", name="Input"),
            PipelineNodeDefinition(
                id="embed",
                type="embedder.text",
                name="Embedder",
                config={"connection_id": connection, "model_name": "m"},
            ),
            PipelineNodeDefinition(
                id="retrieve",
                type="retriever.vector",
                name="Retriever",
                config={"backend": "pgvector", "index_name": "docs", "top_k": 5},
            ),
            PipelineNodeDefinition(
                id="re-embed",
                type="embedder.text",
                name="Re-embedder",
                config={"connection_id": connection, "model_name": "m"},
            ),
            PipelineNodeDefinition(
                id="retrieve-again",
                type="retriever.vector",
                name="Second Retriever",
                config={"backend": "pgvector", "index_name": "docs", "top_k": 5},
            ),
            PipelineNodeDefinition(id="out", type="retrieval.output", name="Out"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="input", target="embed",
                source_port="items", target_port="items",
            ),
            PipelineEdgeDefinition(
                id="e2", source="embed", target="retrieve",
                source_port="items", target_port="items",
            ),
            PipelineEdgeDefinition(
                id="e3", source="retrieve", target="re-embed",
                source_port="items", target_port="items",
            ),
            PipelineEdgeDefinition(
                id="e4", source="re-embed", target="retrieve-again",
                source_port="items", target_port="items",
            ),
            PipelineEdgeDefinition(
                id="e5", source="retrieve-again", target="out",
                source_port="items", target_port="items",
            ),
        ],
    )
    result = PipelineValidator(default_registry()).validate(definition)

    assert not [error for error in result.errors if "delivers items" in error], result.errors
