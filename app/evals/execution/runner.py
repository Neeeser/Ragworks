"""The eval run engine: provision, evaluate every query, aggregate, attribute.

`run_eval` is the background-task entry point (own `session_scope`, never
re-raises — the run row records the outcome). Queries run through the real
retrieval path (`RetrievalService.query_collection`) on a worker pool sized by
the run's `concurrency` — each worker opens its own session, so the main
session stays the single owner of the run row, item persistence, and progress.
Each `EvalRunItem` is persisted the moment it completes (live progress, restart
resilience), and cancellation is checked cooperatively between completions. On
completion the runner aggregates metrics, builds the node-addressed recall
funnel from the recorded traces, and stores both on the run row.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.engine import session_scope
from app.db.repositories import EvalDatasetRepository, EvalRunRepository, PipelineRunRepository
from app.evals.attribution.funnel import QueryFunnelInput, build_funnel
from app.evals.execution.depth import depth_caps, effective_top_k, raise_bound_depths
from app.evals.execution.scoring import aggregate_metrics_mean, failed_item, score_query
from app.evals.provisioning import EvalProvisioner, ProvisionResult, ProvisionSpec
from app.evals.sampling import SamplePlan, build_sample_plan, positive_qrels
from app.pipelines.definition import PipelineDefinition
from app.schemas.enums import EvalRunStatus
from app.schemas.evals import EvalRunConfig
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


def run_eval(run_id: UUID) -> None:
    """Background-task entry point: execute one pending eval run, never raise."""
    with session_scope() as session:
        run = session.get(models.EvalRun, run_id)
        if run is None or run.status != EvalRunStatus.PENDING.value:
            return
        try:
            EvalRunner(session).execute(run)
        except Exception:  # pylint: disable=broad-exception-caught
            # Deliberately broad: the failed status is already persisted on the
            # run row; a background task has no caller left to re-raise to.
            logger.exception("Eval run %s failed", run_id)


@dataclass(frozen=True)
class _QueryContext:
    """Shared, read-only inputs every query evaluation worker needs."""

    run_id: UUID
    user_id: UUID
    collection_id: UUID
    top_k: int
    config: EvalRunConfig
    mapping: dict[str, str]
    indexed_external_ids: set[str]


@dataclass(frozen=True)
class _QueryTask:
    """One sampled query, reduced to read-only data safe to hand a worker thread."""

    external_id: str
    text: str
    gold: dict[str, int]


def _evaluate_task(
    context: _QueryContext, task: _QueryTask
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
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
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


class EvalRunner:
    """Execute one eval run end to end against its recorded configuration."""

    def __init__(self, session: Session) -> None:
        """Bind the runner to its own background session."""
        self.session = session
        self.runs = EvalRunRepository(session)
        self.datasets = EvalDatasetRepository(session)

    def execute(self, run: models.EvalRun) -> None:
        """Drive the run through provisioning, evaluation, and aggregation."""
        try:
            self._execute(run)
        except Exception as exc:
            run.status = EvalRunStatus.FAILED.value
            run.error_message = str(exc) or exc.__class__.__name__
            run.completed_at = utc_now()
            self.session.add(run)
            self.session.commit()
            raise

    def _execute(self, run: models.EvalRun) -> None:
        """The run body; any exception is recorded as a failed run by `execute`."""
        user = self.session.get(models.User, run.user_id)
        dataset = self.session.get(models.EvalDataset, run.dataset_id)
        if user is None or dataset is None:
            raise ValueError("Eval run references a missing user or dataset.")
        config = EvalRunConfig.model_validate(run.config)
        all_queries = self.datasets.list_queries(dataset.id)
        qrels = positive_qrels(self.datasets.list_judgments(dataset.id))
        plan = self._build_plan(dataset, config, all_queries, qrels)

        run.status = EvalRunStatus.PROVISIONING.value
        run.progress_total = len(plan.corpus_doc_ids) + len(plan.query_ids)
        self.session.add(run)
        self.session.commit()

        provision = self._provision(run, user, dataset, plan, config)
        if self._cancelled(run):
            return

        run.status = EvalRunStatus.RUNNING.value
        self.session.add(run)
        self.session.commit()

        queries = self._sampled_queries(all_queries, plan)
        mapping = EvalProvisioner(self.session).document_mapping(provision.collection.id)
        funnel_inputs = self._evaluate_queries(
            run, user, provision.collection, queries, qrels, plan, config, mapping,
            provision.indexed_external_ids,
        )
        if self._cancelled(run):
            return

        self._finalize(run, funnel_inputs)

    # -- phases ---------------------------------------------------------------

    def _build_plan(
        self,
        dataset: models.EvalDataset,
        config: EvalRunConfig,
        queries: list[models.EvalDatasetQuery],
        qrels: dict[str, dict[str, int]],
    ) -> SamplePlan:
        """Sample queries, gold docs, and distractors for this run."""
        documents = self.datasets.list_documents(dataset.id)
        return build_sample_plan(
            query_ids=[query.external_query_id for query in queries],
            qrels={query_id: set(grades) for query_id, grades in qrels.items()},
            corpus_doc_ids=[doc.external_doc_id for doc in documents],
            num_queries=config.num_queries,
            distractor_pool_size=config.distractor_pool_size,
            seed=config.seed,
        )

    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _provision(
        self,
        run: models.EvalRun,
        user: models.User,
        dataset: models.EvalDataset,
        plan: SamplePlan,
        config: EvalRunConfig,
    ) -> ProvisionResult:
        """Ensure the eval collection exists and is ingested; track progress."""
        pipelines = PipelineService(self.session)
        ingestion = self._require_pipeline(pipelines, run.ingestion_pipeline_id, user.id)
        retrieval = self._require_pipeline(pipelines, run.retrieval_pipeline_id, user.id)
        provisioner = EvalProvisioner(self.session)
        cache_key = provisioner.cache_key_for(dataset, ingestion)
        corpus_docs = self.datasets.get_documents_by_external_ids(
            dataset.id, plan.corpus_doc_ids
        )

        def bump() -> None:
            run.progress_done += 1
            self.session.add(run)
            self.session.commit()

        run.status = EvalRunStatus.INGESTING.value
        self.session.add(run)
        self.session.commit()
        result = provisioner.provision(
            user=user,
            spec=ProvisionSpec(
                dataset=dataset,
                cache_key=cache_key,
                ingestion_pipeline=ingestion,
                retrieval_pipeline=retrieval,
                concurrency=config.concurrency,
            ),
            corpus_docs=corpus_docs,
            on_document_done=bump,
        )
        if result.reused:
            run.progress_done = len(plan.corpus_doc_ids)
        run.eval_collection_id = result.collection.id
        self.session.add(run)
        self.session.commit()
        return result

    # pylint: disable-next=too-many-arguments,too-many-positional-arguments,too-many-locals
    def _evaluate_queries(
        self,
        run: models.EvalRun,
        user: models.User,
        collection: models.Collection,
        queries: list[models.EvalDatasetQuery],
        qrels: dict[str, dict[str, int]],
        plan: SamplePlan,
        config: EvalRunConfig,
        mapping: dict[str, str],
        indexed_external_ids: set[str],
    ) -> list[QueryFunnelInput]:
        """Fan sampled queries across the worker pool, persisting each result.

        Workers only retrieve and score (own sessions); the main thread stays
        the single writer of items, progress, and the cancellation check.
        """
        corpus = set(plan.corpus_doc_ids)
        caps = depth_caps(self._retrieval_definition(run))
        top_k = effective_top_k(config, caps.get("result_limit"))
        deepest = max(config.k_values) if config.k_values else 0
        if top_k < deepest:
            logger.warning(
                "Eval run %s: the retrieval pipeline caps depth at %s, below the "
                "deepest cutoff %s — metrics at deeper cutoffs reflect that cap.",
                run.id,
                top_k,
                deepest,
            )
        config = raise_bound_depths(config, top_k, caps)
        context = _QueryContext(
            run_id=run.id,
            user_id=user.id,
            collection_id=collection.id,
            top_k=top_k,
            config=config,
            mapping=mapping,
            indexed_external_ids=indexed_external_ids,
        )
        tasks = [
            _QueryTask(
                external_id=query.external_query_id,
                text=query.text,
                gold={
                    doc_id: grade
                    for doc_id, grade in qrels.get(query.external_query_id, {}).items()
                    if doc_id in corpus
                },
            )
            for query in queries
        ]
        funnel_inputs: list[QueryFunnelInput] = []
        with ThreadPoolExecutor(max_workers=config.concurrency) as pool:
            futures = [pool.submit(_evaluate_task, context, task) for task in tasks]
            for future in as_completed(futures):
                if self._cancelled(run):
                    for pending in futures:
                        pending.cancel()
                    break
                item, funnel_input = future.result()
                self.runs.add_item(item)
                if funnel_input is not None:
                    funnel_inputs.append(funnel_input)
                run.progress_done += 1
                self.session.add(run)
                self.session.commit()
        return funnel_inputs

    def _finalize(self, run: models.EvalRun, funnel_inputs: list[QueryFunnelInput]) -> None:
        """Aggregate metrics and the funnel, then mark the run completed.

        Aggregates mean over the successfully evaluated queries only — a failed
        retrieval is an infrastructure outcome, not a relevance one — and
        `failed_count` is persisted beside them so the survivorship is always
        visible next to every aggregate rather than silently hidden.
        """
        items = self.runs.list_items(run.id)
        run.failed_count = sum(1 for item in items if item.failed)
        run.aggregate_metrics = aggregate_metrics_mean(
            [item.metrics for item in items if not item.failed]
        )
        funnel = build_funnel(funnel_inputs, edges=self._retrieval_edges(run))
        run.funnel_summary = funnel.model_dump(mode="json")
        run.status = EvalRunStatus.COMPLETED.value
        run.completed_at = utc_now()
        self.session.add(run)
        self.session.commit()

    # -- helpers ---------------------------------------------------------------

    @staticmethod
    def _sampled_queries(
        queries: list[models.EvalDatasetQuery], plan: SamplePlan
    ) -> list[models.EvalDatasetQuery]:
        """Filter the loaded queries down to the plan's sample, in plan order."""
        sampled = set(plan.query_ids)
        return sorted(
            (query for query in queries if query.external_query_id in sampled),
            key=lambda query: query.external_query_id,
        )

    def _retrieval_definition(self, run: models.EvalRun) -> PipelineDefinition | None:
        """Load the retrieval pipeline's definition, or None when it is gone."""
        pipeline = self.session.get(models.Pipeline, run.retrieval_pipeline_id)
        if pipeline is None:
            return None
        return PipelineService(self.session).get_definition(pipeline)

    def _retrieval_edges(self, run: models.EvalRun) -> list[tuple[str, str]]:
        """Read (source, target) edges off the retrieval pipeline definition."""
        definition = self._retrieval_definition(run)
        if definition is None:
            return []
        return [(edge.source, edge.target) for edge in definition.edges]

    def _cancelled(self, run: models.EvalRun) -> bool:
        """Cooperative cancellation: re-read the run's status from the DB."""
        self.session.refresh(run)
        return run.status == EvalRunStatus.CANCELLED.value

    @staticmethod
    def _require_pipeline(
        pipelines: PipelineService, pipeline_id: UUID, user_id: UUID
    ) -> models.Pipeline:
        """Return the user-owned pipeline or fail the run with a clear reason."""
        pipeline = pipelines.get_pipeline(pipeline_id, user_id)
        if pipeline is None:
            raise ValueError("Eval run references a pipeline that no longer exists.")
        return pipeline
