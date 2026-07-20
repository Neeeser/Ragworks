"""Reduce recorded node-run summaries to per-node document lists for the funnel.

Item-producing nodes attach a complete ordered `ItemListTrace` to their summary
(`kind="items"`); chunk ids are `{document_id}:{order}`, so each node's item list
reduces to parent-document identities in rank order. Documents outside the
benchmark mapping (not part of the sampled corpus) are dropped. Summaries are
parsed through the tracing wire models (`NodeTraceSummary` / `ItemListTrace`),
not hand-walked dicts: a summary that no longer matches the trace contract is a
logged warning and a skipped node — visible drift, never a silently empty
funnel stage. This module is pure: the runner loads `PipelineNodeRun` rows and
hands their summaries here.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Protocol

from pydantic import ValidationError

from app.evals.attribution.funnel import QueryNodeTrace
from app.pipelines.tracing.recorder import NodeTraceSummary
from app.pipelines.tracing.summaries import ItemListTrace
from app.utils.ordering import unique_in_order

logger = logging.getLogger(__name__)


class NodeRunLike(Protocol):
    """The columns trace extraction needs off a `PipelineNodeRun` row."""

    node_id: str
    node_type: str
    node_name: str
    summary: dict[str, object]


def extract_node_traces(
    node_runs: Sequence[NodeRunLike],
    document_mapping: Mapping[str, str],
) -> list[QueryNodeTrace]:
    """Build one `QueryNodeTrace` per node run that recorded an item list.

    `document_mapping` maps Ragworks document UUIDs (as strings) to the
    benchmark's external document ids. The last `items`-kind output value per
    node wins — for nodes with several item ports, that is the final output list.
    """
    traces: list[QueryNodeTrace] = []
    for node_run in node_runs:
        item_ids = _last_item_list(node_run)
        if item_ids is None:
            continue
        traces.append(
            QueryNodeTrace(
                node_id=node_run.node_id,
                node_type=node_run.node_type,
                label=node_run.node_name,
                document_ids=_to_document_ids(item_ids, document_mapping),
            )
        )
    return traces


def _last_item_list(node_run: NodeRunLike) -> list[str] | None:
    """Return the chunk ids of the last `items`-kind output value, if any."""
    try:
        summary = NodeTraceSummary.model_validate(node_run.summary)
    except ValidationError as exc:
        logger.warning(
            "Node run %s summary does not match the trace contract; "
            "skipping it in the eval funnel: %s",
            node_run.node_id,
            exc,
        )
        return None
    item_ids: list[str] | None = None
    for entry in summary.outputs:
        if entry.kind != "items":
            continue
        try:
            trace = ItemListTrace.model_validate(entry.value)
        except ValidationError as exc:
            logger.warning(
                "Node run %s items output does not match ItemListTrace; "
                "skipping it in the eval funnel: %s",
                node_run.node_id,
                exc,
            )
            continue
        item_ids = [item.id for item in trace.items]
    return item_ids


def _to_document_ids(chunk_ids: list[str], mapping: Mapping[str, str]) -> list[str]:
    """Reduce chunk ids to external document ids, rank-ordered and deduplicated."""
    return unique_in_order(
        external_id
        for chunk_id in chunk_ids
        if (external_id := mapping.get(chunk_id.rsplit(":", 1)[0])) is not None
    )
