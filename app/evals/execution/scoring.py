"""Score one evaluated query and aggregate metrics across a run.

Pure shaping over data the runner already loaded: retrieved chunks map to
benchmark external ids (rank-ordered, document-deduplicated), metrics compute at
the run's configured cutoffs, and the recorded node runs reduce to the per-node
funnel input for this query.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from uuid import UUID

from app.db import models
from app.evals.attribution.constants import INGESTION_NODE_ID
from app.evals.attribution.funnel import QueryFunnelInput
from app.evals.execution.trace_extraction import extract_node_traces
from app.evals.metrics.registry import evaluate_metrics
from app.schemas.evals import EvalRunConfig
from app.schemas.retrieval import CollectionQueryResponse
from app.utils.ordering import unique_in_order


# pylint: disable-next=too-many-arguments
def score_query(
    *,
    run_id: UUID,
    query_external_id: str,
    query_text: str,
    gold: Mapping[str, int],
    config: EvalRunConfig,
    mapping: Mapping[str, str],
    indexed_external_ids: set[str],
    response: CollectionQueryResponse,
    node_runs: Sequence[models.PipelineNodeRun],
) -> tuple[models.EvalRunItem, QueryFunnelInput]:
    """Build the persisted item and funnel input for one successful retrieval.

    `gold` maps each relevant document's external id to its positive relevance
    grade (graded metrics use the grade; set metrics use membership).
    """
    retrieved_external = rank_ordered_documents(
        [chunk.document_id for chunk in response.chunks], mapping
    )
    metrics = evaluate_metrics(
        retrieved_external,
        gold,
        k_values=config.k_values,
        metric_names=config.selected_metrics,
    )
    gold_set = set(gold)
    node_traces = extract_node_traces(node_runs, mapping)
    funnel_input = QueryFunnelInput(
        gold_doc_ids=gold_set,
        indexed_gold_doc_ids=gold_set & indexed_external_ids,
        nodes=node_traces,
    )
    item = models.EvalRunItem(
        run_id=run_id,
        query_external_id=query_external_id,
        query_text=query_text,
        pipeline_run_id=response.pipeline_run_id,
        query_event_id=response.query_event_id,
        result_count=len(response.chunks),
        gold_doc_ids=sorted(gold),
        retrieved=[
            {
                "chunk_id": chunk.chunk_id,
                "document_id": mapping.get(chunk.document_id, chunk.document_id),
                "score": chunk.score,
            }
            for chunk in response.chunks
        ],
        metrics=metrics,
        # The ingestion sentinel leads so the per-document journey starts at
        # indexed coverage, mirroring the run-level funnel's stage 0.
        per_node_funnel=[
            {
                "node_id": INGESTION_NODE_ID,
                "document_ids": sorted(gold_set & indexed_external_ids),
            },
            *(
                {"node_id": trace.node_id, "document_ids": trace.document_ids}
                for trace in node_traces
            ),
        ],
    )
    return item, funnel_input


def failed_item(
    run_id: UUID,
    query_external_id: str,
    query_text: str,
    gold: set[str],
    exc: Exception,
) -> models.EvalRunItem:
    """Record one query whose retrieval raised, without failing the run."""
    return models.EvalRunItem(
        run_id=run_id,
        query_external_id=query_external_id,
        query_text=query_text,
        gold_doc_ids=sorted(gold),
        failed=True,
        error_message=str(exc) or exc.__class__.__name__,
    )


def rank_ordered_documents(
    document_uuids: Sequence[str], mapping: Mapping[str, str]
) -> list[str]:
    """Map retrieved document UUIDs to external ids, rank-ordered, deduplicated."""
    return unique_in_order(
        external
        for document_uuid in document_uuids
        if (external := mapping.get(document_uuid)) is not None
    )


def aggregate_metrics_mean(per_item_metrics: Sequence[Mapping[str, object]]) -> dict[str, float]:
    """Mean each metric key across items that reported it."""
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    for metrics in per_item_metrics:
        for key, value in metrics.items():
            if isinstance(value, (int, float)):
                sums[key] = sums.get(key, 0.0) + float(value)
                counts[key] = counts.get(key, 0) + 1
    return {key: sums[key] / counts[key] for key in sums}
