from __future__ import annotations

from uuid import uuid4

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.services.trace_topology import covers_recorded_nodes, reconstruct_definition


def _node_run(node_id: str, sequence_index: int) -> models.PipelineNodeRun:
    return models.PipelineNodeRun(
        run_id=uuid4(),
        node_id=node_id,
        node_type="chunker.recursive",
        node_name=f"Node {node_id}",
        sequence_index=sequence_index,
        status=models.PipelineRunStatus.COMPLETED,
    )


def _io(node_id: str, io_type: models.PipelineIOType, port: str) -> models.PipelineNodeIO:
    return models.PipelineNodeIO(
        run_id=uuid4(),
        node_run_id=uuid4(),
        node_id=node_id,
        io_type=io_type,
        port=port,
        payload={},
    )


def test_reconstruct_orders_nodes_by_execution_sequence() -> None:
    definition = reconstruct_definition([_node_run("b", 1), _node_run("a", 0)], [])

    assert [node.id for node in definition.nodes] == ["a", "b"]
    assert [(edge.source, edge.target) for edge in definition.edges] == [("a", "b")]


def test_reconstruct_names_edge_ports_from_recorded_io() -> None:
    node_io = [
        _io("a", models.PipelineIOType.OUTPUT, "items"),
        _io("a", models.PipelineIOType.OUTPUT, "ignored"),
        _io("b", models.PipelineIOType.INPUT, "documents"),
    ]

    definition = reconstruct_definition([_node_run("a", 0), _node_run("b", 1)], node_io)

    edge = definition.edges[0]
    assert edge.source_port == "items"
    assert edge.target_port == "documents"


def test_reconstruct_keeps_one_node_per_recorded_node_id() -> None:
    """A node that ran more than once is still one node on the canvas."""
    definition = reconstruct_definition([_node_run("a", 0), _node_run("a", 1)], [])

    assert [node.id for node in definition.nodes] == ["a"]
    assert definition.edges == []


def test_covers_recorded_nodes_reports_the_missing_node() -> None:
    definition = PipelineDefinition(
        nodes=[PipelineNodeDefinition(id="a", type="chunker.recursive", name="A")]
    )

    assert covers_recorded_nodes(definition, [_node_run("a", 0)])
    assert not covers_recorded_nodes(definition, [_node_run("a", 0), _node_run("b", 1)])
