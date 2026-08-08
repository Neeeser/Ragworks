"""Reconstruct a pipeline topology from what a run actually recorded.

A trace shows the graph that ran. When the definition a run executed against
can no longer be resolved -- the run predates `pipeline_version_id`, or its
version row is gone -- the pipeline's *current* definition is a different
graph with different (client-generated) node ids, so a canvas drawn from it
shares no node with the run's ledger. These helpers build a
`PipelineDefinition` out of the run's own `pipeline_node_runs` and
`pipeline_node_io` rows instead.

Edges come from item provenance. `pipeline_node_io` stores whole payloads, and
an items stream carries stable `Item.id`s across nodes
(`app/pipelines/payloads.py`), so a consumer's input stream *is* the producer's
output object. Matching a consumed stream's ids back to the nearest earlier
node that emitted them recovers the real wiring, fan-out and fan-in alike -- a
variadic port records one payload per incoming edge, so each is resolved on its
own. A stream with no recoverable producer draws no edge: execution order is
not evidence that two nodes exchanged anything.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.schemas.enums import PipelineIOType


@dataclass(frozen=True)
class _Stream:
    """One recorded payload on a port, reduced to the item ids it carried."""

    node_id: str
    port: str
    sequence_index: int
    item_ids: frozenset[str]
    #: The stream's whole recorded batch. Two nodes can emit the same ids (an
    #: indexer passes its items straight through), and then the batch the
    #: consumer was handed is what tells their outputs apart.
    batch: dict[str, Any]


def _item_ids(batch: object) -> frozenset[str]:
    """Return the item ids of a serialized `ItemBatch`, if it is one."""
    if not isinstance(batch, dict):
        return frozenset()
    items = batch.get("items")
    if not isinstance(items, list):
        return frozenset()
    return frozenset(
        item["id"] for item in items if isinstance(item, dict) and isinstance(item.get("id"), str)
    )


def _batches(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Split a recorded payload into the item batches it carried.

    A variadic port (`accepts_many`) receives a list of payloads -- one per
    edge feeding it -- which the recorder stores as `{"value": [...]}`, so the
    list length is the port's edge count.
    """
    if _item_ids(payload):
        return [payload]
    value = payload.get("value")
    if isinstance(value, list):
        return [entry for entry in value if isinstance(entry, dict) and _item_ids(entry)]
    return []


def _stream(record: models.PipelineNodeIO, batch: dict[str, Any], sequence_index: int) -> _Stream:
    """Build the stream one recorded batch on one port stands for."""
    return _Stream(
        node_id=record.node_id,
        port=record.port,
        sequence_index=sequence_index,
        item_ids=_item_ids(batch),
        batch=batch,
    )


def _output_streams(
    node_io: Sequence[models.PipelineNodeIO],
    sequence_by_run: dict[UUID, int],
) -> list[_Stream]:
    """Reduce every recorded output payload to the streams it carried."""
    return [
        _stream(record, batch, sequence_by_run.get(record.node_run_id, 0))
        for record in node_io
        if record.io_type == PipelineIOType.OUTPUT
        for batch in _batches(record.payload)
    ]


def _producer(
    consumed: _Stream,
    produced: Sequence[_Stream],
    taken: set[tuple[str, str]],
) -> _Stream | None:
    """Return the output stream a consumed stream came from, if recoverable.

    Ranked by how much of the consumed stream an output accounts for, then by
    whether it is the very batch the consumer was handed, then by recency --
    the nearest earlier node still holding the items is the one on the other
    end of the edge. `taken` holds the endpoints already assigned to sibling
    streams on the same port, so a variadic port resolves to as many distinct
    producers as it was handed batches.
    """
    ranked = [
        (
            len(stream.item_ids & consumed.item_ids),
            stream.batch == consumed.batch,
            stream.sequence_index,
            stream,
        )
        for stream in produced
        if stream.sequence_index < consumed.sequence_index
        and stream.node_id != consumed.node_id
        and stream.item_ids & consumed.item_ids
        and (stream.node_id, stream.port) not in taken
    ]
    if not ranked:
        return None
    return max(ranked, key=lambda entry: entry[:3])[3]


def reconstruct_definition(
    node_runs: Sequence[models.PipelineNodeRun],
    node_io: Sequence[models.PipelineNodeIO],
) -> PipelineDefinition:
    """Build a definition whose nodes are exactly the run's recorded nodes.

    Node config is not recorded and stays empty -- the graph is what ran, at
    the level of detail the run kept.
    """
    ordered = sorted(node_runs, key=lambda run: run.sequence_index)
    nodes: list[PipelineNodeDefinition] = []
    seen: set[str] = set()
    for run in ordered:
        if run.node_id in seen:
            continue
        seen.add(run.node_id)
        nodes.append(PipelineNodeDefinition(id=run.node_id, type=run.node_type, name=run.node_name))

    sequence_by_run = {run.id: run.sequence_index for run in ordered}
    produced = _output_streams(node_io, sequence_by_run)
    edges: dict[tuple[str, str, str, str], PipelineEdgeDefinition] = {}
    for record in node_io:
        if record.io_type != PipelineIOType.INPUT:
            continue
        taken: set[tuple[str, str]] = set()
        for batch in _batches(record.payload):
            consumed = _stream(record, batch, sequence_by_run.get(record.node_run_id, 0))
            source = _producer(consumed, produced, taken)
            if source is None:
                continue
            taken.add((source.node_id, source.port))
            key = (source.node_id, source.port, consumed.node_id, consumed.port)
            edges.setdefault(
                key,
                PipelineEdgeDefinition(
                    id=f"{source.node_id}.{source.port}::{consumed.node_id}.{consumed.port}",
                    source=source.node_id,
                    target=consumed.node_id,
                    source_port=source.port,
                    target_port=consumed.port,
                ),
            )
    return PipelineDefinition(nodes=nodes, edges=list(edges.values()))


def covers_recorded_nodes(
    definition: PipelineDefinition,
    node_runs: Sequence[models.PipelineNodeRun],
) -> bool:
    """Report whether the definition contains every node the run recorded."""
    defined = {node.id for node in definition.nodes}
    return all(run.node_id in defined for run in node_runs)
