"""Reconstruct a pipeline topology from what a run actually recorded.

A trace shows the graph that ran. When the definition a run executed against
can no longer be resolved -- the run predates `pipeline_version_id`, or its
version row is gone -- the pipeline's *current* definition is a different
graph with different (client-generated) node ids, so a canvas drawn from it
shares no node with the run's ledger. These helpers build a
`PipelineDefinition` out of the run's own `pipeline_node_runs` and
`pipeline_node_io` rows instead, so every recorded node appears.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from itertools import pairwise

from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.schemas.enums import PipelineIOType


def _ports_by_node(
    node_io: Iterable[models.PipelineNodeIO],
    io_type: PipelineIOType,
) -> dict[str, str]:
    """Return each node's first recorded port of the given direction."""
    ports: dict[str, str] = {}
    for record in node_io:
        if record.io_type == io_type:
            ports.setdefault(record.node_id, record.port)
    return ports


def reconstruct_definition(
    node_runs: Sequence[models.PipelineNodeRun],
    node_io: Sequence[models.PipelineNodeIO],
) -> PipelineDefinition:
    """Build a definition whose nodes are exactly the run's recorded nodes.

    Node runs carry no edge data, so the topology is the execution order:
    consecutive recorded nodes are chained, with the ports each node actually
    read and wrote naming the endpoints. Node config is not recorded and stays
    empty -- the graph is what ran, at the level of detail the run kept.
    """
    ordered = sorted(node_runs, key=lambda run: run.sequence_index)
    nodes: list[PipelineNodeDefinition] = []
    seen: set[str] = set()
    for run in ordered:
        if run.node_id in seen:
            continue
        seen.add(run.node_id)
        nodes.append(
            PipelineNodeDefinition(id=run.node_id, type=run.node_type, name=run.node_name)
        )

    outputs = _ports_by_node(node_io, PipelineIOType.OUTPUT)
    inputs = _ports_by_node(node_io, PipelineIOType.INPUT)
    edges = [
        PipelineEdgeDefinition(
            id=f"{source.id}::{target.id}",
            source=source.id,
            target=target.id,
            source_port=outputs.get(source.id),
            target_port=inputs.get(target.id),
        )
        for source, target in pairwise(nodes)
    ]
    return PipelineDefinition(nodes=nodes, edges=edges)


def covers_recorded_nodes(
    definition: PipelineDefinition,
    node_runs: Sequence[models.PipelineNodeRun],
) -> bool:
    """Report whether the definition contains every node the run recorded."""
    defined = {node.id for node in definition.nodes}
    return all(run.node_id in defined for run in node_runs)
