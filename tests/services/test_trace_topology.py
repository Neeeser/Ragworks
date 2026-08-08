from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.services.trace_topology import covers_recorded_nodes, reconstruct_definition

RUN_ID = uuid4()


def _node_run(node_id: str, sequence_index: int) -> models.PipelineNodeRun:
    return models.PipelineNodeRun(
        id=uuid4(),
        run_id=RUN_ID,
        node_id=node_id,
        node_type="chunker.recursive",
        node_name=f"Node {node_id}",
        sequence_index=sequence_index,
        status=models.PipelineRunStatus.COMPLETED,
    )


def _batch(*item_ids: str) -> dict[str, Any]:
    """A serialized `ItemBatch` the way the recorder persists one."""
    return {"items": [{"id": item_id} for item_id in item_ids], "usage": {}}


def _io(
    node_run_id: UUID,
    node_id: str,
    io_type: models.PipelineIOType,
    port: str,
    payload: dict[str, Any],
) -> models.PipelineNodeIO:
    return models.PipelineNodeIO(
        run_id=RUN_ID,
        node_run_id=node_run_id,
        node_id=node_id,
        io_type=io_type,
        port=port,
        payload=payload,
    )


def _edges(definition: PipelineDefinition) -> set[tuple[str, str]]:
    return {(edge.source, edge.target) for edge in definition.edges}


def test_reconstruct_orders_nodes_by_execution_sequence() -> None:
    definition = reconstruct_definition([_node_run("b", 1), _node_run("a", 0)], [])

    assert [node.id for node in definition.nodes] == ["a", "b"]


def test_reconstruct_recovers_a_branching_graph_from_item_provenance() -> None:
    """A hybrid retrieval run: one input fans out to two retrieval branches
    whose results fan back in to a fusion node through one variadic port."""
    runs = {
        node_id: _node_run(node_id, index)
        for index, node_id in enumerate(["input", "bm25", "embed", "vector", "fuse"])
    }
    node_io = [
        _io(runs["input"].id, "input", models.PipelineIOType.OUTPUT, "items", _batch("query")),
        _io(runs["bm25"].id, "bm25", models.PipelineIOType.INPUT, "items", _batch("query")),
        _io(runs["bm25"].id, "bm25", models.PipelineIOType.OUTPUT, "items", _batch("doc-a:0")),
        _io(runs["embed"].id, "embed", models.PipelineIOType.INPUT, "items", _batch("query")),
        _io(runs["embed"].id, "embed", models.PipelineIOType.OUTPUT, "items", _batch("query")),
        _io(runs["vector"].id, "vector", models.PipelineIOType.INPUT, "items", _batch("query")),
        _io(runs["vector"].id, "vector", models.PipelineIOType.OUTPUT, "items", _batch("doc-b:0")),
        _io(
            runs["fuse"].id,
            "fuse",
            models.PipelineIOType.INPUT,
            "items",
            {"value": [_batch("doc-a:0"), _batch("doc-b:0")]},
        ),
    ]

    definition = reconstruct_definition(list(runs.values()), node_io)

    assert _edges(definition) == {
        ("input", "bm25"),
        ("input", "embed"),
        ("embed", "vector"),
        ("bm25", "fuse"),
        ("vector", "fuse"),
    }


def test_reconstruct_resolves_a_variadic_port_to_one_producer_per_batch() -> None:
    """Both branches of an ingestion fan-in reach the terminal node, even
    though the indexers relay the item ids their upstream built."""
    runs = {
        node_id: _node_run(node_id, index)
        for index, node_id in enumerate(["chunk", "bm25", "embed", "vector", "out"])
    }
    chunks, embedded = _batch("doc:0"), {"items": [{"id": "doc:0", "embedding": [0.5]}], "usage": {}}
    node_io = [
        _io(runs["chunk"].id, "chunk", models.PipelineIOType.OUTPUT, "items", chunks),
        _io(runs["bm25"].id, "bm25", models.PipelineIOType.INPUT, "items", chunks),
        _io(runs["bm25"].id, "bm25", models.PipelineIOType.OUTPUT, "items", chunks),
        _io(runs["embed"].id, "embed", models.PipelineIOType.INPUT, "items", chunks),
        _io(runs["embed"].id, "embed", models.PipelineIOType.OUTPUT, "items", embedded),
        _io(runs["vector"].id, "vector", models.PipelineIOType.INPUT, "items", embedded),
        _io(runs["vector"].id, "vector", models.PipelineIOType.OUTPUT, "items", embedded),
        _io(
            runs["out"].id,
            "out",
            models.PipelineIOType.INPUT,
            "items",
            {"value": [embedded, chunks]},
        ),
    ]

    definition = reconstruct_definition(list(runs.values()), node_io)

    assert {("vector", "out"), ("bm25", "out")} <= _edges(definition)


def test_reconstruct_attributes_each_edge_to_the_ports_that_carried_it() -> None:
    producer, consumer = _node_run("producer", 0), _node_run("consumer", 1)
    node_io = [
        _io(producer.id, "producer", models.PipelineIOType.OUTPUT, "matches", _batch("a")),
        _io(producer.id, "producer", models.PipelineIOType.OUTPUT, "other", _batch("z")),
        _io(consumer.id, "consumer", models.PipelineIOType.INPUT, "documents", _batch("a")),
    ]

    definition = reconstruct_definition([producer, consumer], node_io)

    edge = definition.edges[0]
    assert (edge.source_port, edge.target_port) == ("matches", "documents")


def test_reconstruct_draws_no_edge_between_nodes_that_exchanged_no_items() -> None:
    """Execution order is not evidence that two nodes are connected."""
    first, second = _node_run("first", 0), _node_run("second", 1)
    node_io = [
        _io(first.id, "first", models.PipelineIOType.OUTPUT, "items", _batch("a")),
        _io(second.id, "second", models.PipelineIOType.INPUT, "items", _batch("unrelated")),
        _io(second.id, "second", models.PipelineIOType.OUTPUT, "result", {"response": {}}),
    ]

    definition = reconstruct_definition([first, second], node_io)

    assert [node.id for node in definition.nodes] == ["first", "second"]
    assert definition.edges == []


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
