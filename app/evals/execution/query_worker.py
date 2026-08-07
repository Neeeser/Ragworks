"""Evaluating one sampled query, on a worker thread of its own.

Split from the runner because everything here is deliberately session-free
until it opens its own `session_scope`: the runner's session stays the single
owner of the run row, and a worker only ever touches the read-only primitives
it was handed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from app.db import models
from app.db.engine import session_scope
from app.db.repositories import PipelineRunRepository
from app.evals.attribution.funnel import QueryFunnelInput
from app.evals.execution.scoring import failed_item, score_query
from app.pipelines.payloads import MediaAsset
from app.schemas.evals import EvalRunConfig
from app.services.retrieval import RetrievalService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class QueryContext:
    """Shared, read-only inputs every query evaluation worker needs."""

    run_id: UUID
    user_id: UUID
    collection_id: UUID
    top_k: int
    config: EvalRunConfig
    mapping: dict[str, str]
    indexed_external_ids: set[str]


@dataclass(frozen=True)
class QueryTask:
    """One sampled query, reduced to read-only data safe to hand a worker thread.

    `media` is the dataset's stored image reference, handed to retrieval
    untouched: the bytes are already on disk, so an image query re-encodes
    nothing. An image-only query has empty `text`.
    """

    external_id: str
    text: str
    gold: dict[str, int]
    media: MediaAsset | None = None


def evaluate_task(
    context: QueryContext, task: QueryTask
) -> tuple[models.EvalRunItem, QueryFunnelInput | None]:
    """Evaluate one query in its own session; a failure is recorded, never fatal.

    Runs on a worker thread: everything it touches comes from `context`/`task`
    primitives or its own `session_scope`, never the runner's session.
    """
    with session_scope() as session:
        user = session.get(models.User, context.user_id)
        collection = session.get(models.Collection, context.collection_id)
        if user is None or collection is None:
            raise ValueError("Eval run lost its user or collection mid-run.")
        try:
            response = RetrievalService(session).query_collection(
                user,
                collection,
                task.text,
                top_k=context.top_k,
                arguments=context.config.run_inputs or None,
                query_media=task.media,
            )
        except Exception as exc:
            # One provider hiccup fails one item, not the whole run.
            logger.warning("Eval query %s failed: %s", task.external_id, exc)
            return (
                failed_item(context.run_id, task.external_id, task.text, set(task.gold), exc),
                None,
            )
        return score_query(
            run_id=context.run_id,
            query_external_id=task.external_id,
            query_text=task.text,
            gold=task.gold,
            config=context.config,
            mapping=context.mapping,
            indexed_external_ids=context.indexed_external_ids,
            response=response,
            node_runs=(
                PipelineRunRepository(session).list_node_runs(response.pipeline_run_id)
                if response.pipeline_run_id is not None
                else []
            ),
        )
