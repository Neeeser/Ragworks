"""Definition diffing: the change list behind revision history and save gating."""

from __future__ import annotations

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
    PipelineNodePosition,
)
from app.pipelines.diff import diff_definitions, material_changes


def _definition() -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="a",
                type="chunker.token",
                name="Chunker",
                config={"chunk_size": 1024, "chunk_overlap": 200},
                position={"x": 0, "y": 0},
            ),
            PipelineNodeDefinition(
                id="b",
                type="embedder.text",
                name="Embedder",
                config={},
                position={"x": 300, "y": 0},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="a", target="b", source_port="chunks", target_port="chunks"
            )
        ],
    )


def test_identical_definitions_have_no_changes() -> None:
    assert diff_definitions(_definition(), _definition()) == []


def test_config_change_is_described_per_key() -> None:
    new = _definition()
    new.nodes[0].config = {"chunk_size": 512, "chunk_overlap": 200}

    changes = diff_definitions(_definition(), new)

    assert len(changes) == 1
    assert changes[0].kind == "node_config"
    assert "chunk_size" in changes[0].summary
    assert "1024" in changes[0].summary
    assert "512" in changes[0].summary


def test_node_add_remove_rename_and_edges_are_reported() -> None:
    old = _definition()
    new = _definition()
    new.nodes[1].name = "Query Embedder"
    new.nodes.append(
        PipelineNodeDefinition(id="c", type="retrieval.output", name="Output", config={})
    )
    new.edges.append(PipelineEdgeDefinition(id="e2", source="b", target="c"))

    kinds = {change.kind for change in diff_definitions(old, new)}

    assert kinds == {"node_added", "node_renamed", "edge_added"}


def test_edge_identity_ignores_client_generated_ids() -> None:
    new = _definition()
    new.edges[0].id = "totally-different-id"

    assert diff_definitions(_definition(), new) == []


def test_position_moves_collapse_to_one_layout_change() -> None:
    new = _definition()
    new.nodes[0].position = PipelineNodePosition(x=50, y=90)
    new.nodes[1].position = PipelineNodePosition(x=400, y=90)

    changes = diff_definitions(_definition(), new)

    assert [change.kind for change in changes] == ["layout"]
    assert material_changes(changes) == []
