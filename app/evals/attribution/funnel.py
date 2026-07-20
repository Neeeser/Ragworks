"""Build the per-node recall funnel from per-query trace data.

For each evaluated query we know its gold documents, which of them were indexed
(ingestion coverage), and the ordered documents each pipeline node emitted. This
module aggregates gold-document retention per node across every query, producing a
graph-shaped funnel whose first stage is ingestion coverage. It stays pure — the
run engine extracts the per-query inputs from `ItemListTrace` and hands them here —
so it is testable without a database or a pipeline run.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.evals.attribution.constants import (
    INGESTION_LABEL,
    INGESTION_NODE_ID,
    INGESTION_NODE_TYPE,
)
from app.evals.attribution.findings import derive_findings
from app.schemas.evals import FunnelStage, FunnelSummary


@dataclass(frozen=True)
class QueryNodeTrace:
    """One pipeline node's output for one query, reduced to document identities."""

    node_id: str
    node_type: str
    label: str
    document_ids: list[str]


@dataclass(frozen=True)
class QueryFunnelInput:
    """Everything one evaluated query contributes to the funnel."""

    gold_doc_ids: set[str]
    indexed_gold_doc_ids: set[str]
    nodes: list[QueryNodeTrace]


@dataclass
class _Accumulator:
    """Running gold-retention totals for one funnel stage."""

    node_id: str
    node_type: str
    label: str
    retained: int = 0
    total: int = 0


def build_funnel(
    queries: Sequence[QueryFunnelInput],
    edges: Sequence[tuple[str, str]],
) -> FunnelSummary:
    """Aggregate per-query trace data into a funnel plus node-addressed findings."""
    ingestion = _Accumulator(INGESTION_NODE_ID, INGESTION_NODE_TYPE, INGESTION_LABEL)
    node_accumulators: dict[str, _Accumulator] = {}
    order: list[str] = []

    for query in queries:
        gold = query.gold_doc_ids
        gold_total = len(gold)
        ingestion.retained += len(query.indexed_gold_doc_ids & gold)
        ingestion.total += gold_total
        for node in query.nodes:
            accumulator = node_accumulators.get(node.node_id)
            if accumulator is None:
                accumulator = _Accumulator(node.node_id, node.node_type, node.label)
                node_accumulators[node.node_id] = accumulator
                order.append(node.node_id)
            accumulator.retained += len(set(node.document_ids) & gold)
            accumulator.total += gold_total

    stages = [_to_stage(ingestion)]
    stages.extend(_to_stage(node_accumulators[node_id]) for node_id in order)
    findings = derive_findings(stages, edges)
    return FunnelSummary(stages=stages, findings=findings)


def _to_stage(accumulator: _Accumulator) -> FunnelStage:
    """Convert a running accumulator into a wire funnel stage."""
    retention = accumulator.retained / accumulator.total if accumulator.total else 0.0
    return FunnelStage(
        node_id=accumulator.node_id,
        node_type=accumulator.node_type,
        label=accumulator.label,
        gold_retained=accumulator.retained,
        gold_total=accumulator.total,
        retention=retention,
    )
