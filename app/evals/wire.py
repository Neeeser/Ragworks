"""Explicit db-row → wire-schema conversion for the evals API.

Kept beside the service so routes stay thin and the API never returns a db model
(the table shape is not the contract).
"""

from __future__ import annotations

from collections.abc import Iterable

from app.db import models
from app.schemas.enums import (
    EvalDatasetSource,
    EvalDatasetStatus,
    EvalRunStatus,
    RelevanceGranularity,
)
from app.schemas.evals import (
    EvalDatasetRead,
    EvalItemNodeDocs,
    EvalRetrievedChunk,
    EvalRunConfig,
    EvalRunItemRead,
    EvalRunRead,
    EvalRunSummary,
    FunnelSummary,
)


def to_dataset_read(dataset: models.EvalDataset) -> EvalDatasetRead:
    """Shape one dataset row for the wire."""
    return EvalDatasetRead(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        source=EvalDatasetSource(dataset.source),
        source_ref=dataset.source_ref,
        relevance_granularity=RelevanceGranularity(dataset.relevance_granularity),
        status=EvalDatasetStatus(dataset.status),
        error_message=dataset.error_message,
        num_queries=dataset.num_queries,
        num_corpus_docs=dataset.num_corpus_docs,
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
    )


def to_run_read(run: models.EvalRun) -> EvalRunRead:
    """Shape one run row (with funnel and aggregates) for the wire."""
    return EvalRunRead(
        id=run.id,
        name=run.name,
        dataset_id=run.dataset_id,
        eval_collection_id=run.eval_collection_id,
        ingestion_pipeline_id=run.ingestion_pipeline_id,
        retrieval_pipeline_id=run.retrieval_pipeline_id,
        status=EvalRunStatus(run.status),
        config=EvalRunConfig.model_validate(run.config),
        progress_done=run.progress_done,
        progress_total=run.progress_total,
        failed_count=run.failed_count,
        aggregate_metrics={
            key: float(value)
            for key, value in run.aggregate_metrics.items()
            if isinstance(value, (int, float))
        },
        funnel=FunnelSummary.model_validate(run.funnel_summary)
        if run.funnel_summary
        else FunnelSummary(),
        error_message=run.error_message,
        created_at=run.created_at,
        updated_at=run.updated_at,
        completed_at=run.completed_at,
    )


def to_run_summary(run: models.EvalRun) -> EvalRunSummary:
    """Shape one run row for list views."""
    return EvalRunSummary(
        id=run.id,
        name=run.name,
        dataset_id=run.dataset_id,
        status=EvalRunStatus(run.status),
        progress_done=run.progress_done,
        progress_total=run.progress_total,
        failed_count=run.failed_count,
        aggregate_metrics={
            key: float(value)
            for key, value in run.aggregate_metrics.items()
            if isinstance(value, (int, float))
        },
        created_at=run.created_at,
    )


def to_run_item_read(item: models.EvalRunItem) -> EvalRunItemRead:
    """Shape one per-query item row for the wire."""
    retrieved = [
        EvalRetrievedChunk.model_validate(entry)
        for entry in item.retrieved
        if isinstance(entry, dict) and "document_id" in entry
    ]
    return EvalRunItemRead(
        id=item.id,
        query_external_id=item.query_external_id,
        query_text=item.query_text,
        pipeline_run_id=item.pipeline_run_id,
        query_event_id=item.query_event_id,
        result_count=item.result_count,
        gold_doc_ids=list(item.gold_doc_ids),
        retrieved_document_ids=_rank_ordered_unique(
            chunk.document_id for chunk in retrieved
        ),
        retrieved=retrieved,
        per_node_funnel=[
            EvalItemNodeDocs.model_validate(entry)
            for entry in item.per_node_funnel
            if isinstance(entry, dict) and "node_id" in entry
        ],
        metrics={
            key: float(value)
            for key, value in item.metrics.items()
            if isinstance(value, (int, float))
        },
        failed=item.failed,
        error_message=item.error_message,
    )


def _rank_ordered_unique(document_ids: Iterable[str]) -> list[str]:
    """Deduplicate document ids while preserving rank order."""
    seen: set[str] = set()
    ordered: list[str] = []
    for document_id in document_ids:
        if document_id in seen:
            continue
        seen.add(document_id)
        ordered.append(document_id)
    return ordered
