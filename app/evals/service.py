"""EvalService: the facade routes call for datasets, runs, and eval collections.

Owns dataset import/upload lifecycle, run creation and cancellation, and the
benchmark-collections management surface. Long work never happens in-request:
dataset downloads and run execution are background tasks
(`run_dataset_download`, `app.evals.execution.runner.run_eval`) whose outcome is
the persisted row. Raises typed domain errors; routes translate.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlmodel import Session, col, func, select

from app.db import models
from app.db.engine import session_scope
from app.db.repositories import CollectionRepository, EvalDatasetRepository, EvalRunRepository
from app.evals.datasets.base import DatasetTriple
from app.evals.datasets.builtin import download_builtin, get_builtin, list_builtin
from app.evals.datasets.upload import parse_beir_upload
from app.evals.metrics.registry import list_metrics
from app.schemas.enums import EvalDatasetSource, EvalDatasetStatus, EvalRunStatus
from app.schemas.evals import (
    BuiltinDatasetInfo,
    EvalCollectionRead,
    EvalMetricInfo,
    EvalRunCreate,
)
from app.services.collection_deletion import CollectionDeletionService
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipelines import PipelineService

logger = logging.getLogger(__name__)

_ACTIVE_RUN_STATUSES = (
    EvalRunStatus.PENDING.value,
    EvalRunStatus.PROVISIONING.value,
    EvalRunStatus.INGESTING.value,
    EvalRunStatus.RUNNING.value,
)


def run_dataset_download(dataset_id: UUID) -> None:
    """Background-task entry point: download one builtin benchmark, never raise."""
    with session_scope() as session:
        dataset = session.get(models.EvalDataset, dataset_id)
        if dataset is None or dataset.status != EvalDatasetStatus.DOWNLOADING.value:
            return
        try:
            entry = get_builtin(dataset.source_ref or "")
            triple = download_builtin(entry)
            EvalService(session).persist_triple(dataset, triple)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # Deliberately broad: the FAILED dataset row is the outcome a
            # background task records; there is no caller left to re-raise to.
            logger.exception("Benchmark download failed for dataset %s", dataset_id)
            dataset.status = EvalDatasetStatus.FAILED.value
            dataset.error_message = str(exc) or exc.__class__.__name__
            session.add(dataset)
            session.commit()


class EvalService:
    """Facade for eval datasets, runs, and eval-collection management."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request (or background) session."""
        self.session = session
        self.datasets = EvalDatasetRepository(session)
        self.runs = EvalRunRepository(session)

    # -- catalogs --------------------------------------------------------------

    @staticmethod
    def builtin_catalog() -> list[BuiltinDatasetInfo]:
        """Return the curated benchmark registry for the import picker."""
        return [
            BuiltinDatasetInfo(
                key=entry.key,
                name=entry.name,
                description=entry.description,
                num_queries=entry.num_queries,
                num_corpus_docs=entry.num_corpus_docs,
            )
            for entry in list_builtin()
        ]

    @staticmethod
    def metric_catalog() -> list[EvalMetricInfo]:
        """Return every registered metric with its tooltip description."""
        return [
            EvalMetricInfo(
                name=metric.name,
                label=metric.label,
                description=metric.description,
                is_rank_aware=metric.is_rank_aware,
            )
            for metric in list_metrics()
        ]

    # -- datasets ---------------------------------------------------------------

    def import_builtin(self, user: models.User, key: str, name: str | None) -> models.EvalDataset:
        """Create a `downloading` dataset row for a curated benchmark.

        The caller schedules `run_dataset_download` to fetch and persist the
        triple; this method only validates the key and records the intent.
        """
        entry = get_builtin(key)
        dataset = self.datasets.add(
            models.EvalDataset(
                user_id=user.id,
                name=name or entry.name,
                description=entry.description,
                source=EvalDatasetSource.BUILTIN_BENCHMARK.value,
                source_ref=entry.key,
                status=EvalDatasetStatus.DOWNLOADING.value,
                num_queries=entry.num_queries,
                num_corpus_docs=entry.num_corpus_docs,
            )
        )
        self.session.commit()
        self.session.refresh(dataset)
        return dataset

    # pylint: disable-next=too-many-arguments
    def upload_dataset(
        self,
        user: models.User,
        *,
        name: str,
        corpus: str,
        queries: str,
        qrels: str,
        description: str | None = None,
    ) -> models.EvalDataset:
        """Parse and persist a user-uploaded BEIR-format golden dataset."""
        triple = parse_beir_upload(
            name=name, corpus=corpus, queries=queries, qrels=qrels, description=description
        )
        dataset = self.datasets.add(
            models.EvalDataset(
                user_id=user.id,
                name=name,
                description=description,
                source=EvalDatasetSource.CUSTOM_UPLOAD.value,
                status=EvalDatasetStatus.DOWNLOADING.value,
            )
        )
        return self.persist_triple(dataset, triple)

    def persist_triple(
        self, dataset: models.EvalDataset, triple: DatasetTriple
    ) -> models.EvalDataset:
        """Store a parsed triple under a dataset row and mark it ready."""
        self.datasets.add_documents(
            [
                models.EvalDatasetDocument(
                    dataset_id=dataset.id,
                    external_doc_id=doc.external_doc_id,
                    title=doc.title,
                    text=doc.text,
                    doc_metadata=dict(doc.metadata),
                )
                for doc in triple.corpus
            ]
        )
        self.datasets.add_queries(
            [
                models.EvalDatasetQuery(
                    dataset_id=dataset.id,
                    external_query_id=query.external_query_id,
                    text=query.text,
                )
                for query in triple.queries
            ]
        )
        self.datasets.add_judgments(
            [
                models.EvalRelevanceJudgment(
                    dataset_id=dataset.id,
                    query_external_id=qrel.query_external_id,
                    doc_external_id=qrel.doc_external_id,
                    relevance=qrel.relevance,
                )
                for qrel in triple.qrels
            ]
        )
        dataset.status = EvalDatasetStatus.READY.value
        dataset.relevance_granularity = triple.relevance_granularity.value
        dataset.num_queries = len(triple.queries)
        dataset.num_corpus_docs = len(triple.corpus)
        dataset.error_message = None
        self.session.add(dataset)
        self.session.commit()
        self.session.refresh(dataset)
        return dataset

    def list_datasets(self, user: models.User) -> list[models.EvalDataset]:
        """Return the user's datasets, newest first."""
        return self.datasets.list_for_user(user.id)

    def get_dataset(self, user: models.User, dataset_id: UUID) -> models.EvalDataset:
        """Return a user-owned dataset or raise NotFoundError."""
        dataset = self.datasets.get_for_user(dataset_id, user.id)
        if dataset is None:
            raise NotFoundError("Eval dataset not found.")
        return dataset

    def delete_dataset(self, user: models.User, dataset_id: UUID) -> None:
        """Delete a dataset; blocked while runs still reference it."""
        dataset = self.get_dataset(user, dataset_id)
        statement = select(func.count(col(models.EvalRun.id))).where(  # pylint: disable=not-callable
            col(models.EvalRun.dataset_id) == dataset.id
        )
        if self.session.exec(statement).one() > 0:
            raise InvalidInputError(
                "This dataset has eval runs referencing it. Delete those runs first."
            )
        self.datasets.delete(dataset)
        self.session.commit()

    # -- runs -------------------------------------------------------------------

    def create_run(self, user: models.User, payload: EvalRunCreate) -> models.EvalRun:
        """Validate and record a new eval run; the caller schedules `run_eval`."""
        dataset = self.get_dataset(user, payload.dataset_id)
        if dataset.status != EvalDatasetStatus.READY.value:
            raise InvalidInputError("Eval dataset is not ready to run against.")
        self._require_pipeline(
            user, payload.ingestion_pipeline_id, models.PipelineKind.INGESTION
        )
        self._require_pipeline(
            user, payload.retrieval_pipeline_id, models.PipelineKind.RETRIEVAL
        )
        run = self.runs.add(
            models.EvalRun(
                user_id=user.id,
                dataset_id=dataset.id,
                ingestion_pipeline_id=payload.ingestion_pipeline_id,
                retrieval_pipeline_id=payload.retrieval_pipeline_id,
                name=payload.name,
                config=payload.config.model_dump(mode="json"),
                status=EvalRunStatus.PENDING.value,
            )
        )
        self.session.commit()
        self.session.refresh(run)
        return run

    def list_runs(self, user: models.User) -> list[models.EvalRun]:
        """Return the user's runs, newest first."""
        return self.runs.list_for_user(user.id)

    def get_run(self, user: models.User, run_id: UUID) -> models.EvalRun:
        """Return a user-owned run or raise NotFoundError."""
        run = self.runs.get_for_user(run_id, user.id)
        if run is None:
            raise NotFoundError("Eval run not found.")
        return run

    def list_run_items(
        self, user: models.User, run_id: UUID
    ) -> tuple[list[models.EvalRunItem], dict[str, str]]:
        """Return a run's per-query items plus titles for the documents involved.

        The title map covers every gold and retrieved external doc id across
        the items, so the UI can name documents instead of showing raw ids.
        """
        run = self.get_run(user, run_id)
        items = self.runs.list_items(run.id)
        involved: set[str] = set()
        for item in items:
            involved.update(item.gold_doc_ids)
            involved.update(
                str(entry["document_id"])
                for entry in item.retrieved
                if isinstance(entry, dict) and "document_id" in entry
            )
        titles = self.datasets.get_titles_by_external_ids(run.dataset_id, sorted(involved))
        return items, titles

    def cancel_run(self, user: models.User, run_id: UUID) -> models.EvalRun:
        """Request cooperative cancellation of an in-flight run."""
        run = self.get_run(user, run_id)
        if run.status not in _ACTIVE_RUN_STATUSES:
            raise InvalidInputError("Only an in-flight eval run can be cancelled.")
        run.status = EvalRunStatus.CANCELLED.value
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run

    def delete_run(self, user: models.User, run_id: UUID) -> None:
        """Delete a finished run and its items (the eval collection is kept)."""
        run = self.get_run(user, run_id)
        if run.status in _ACTIVE_RUN_STATUSES:
            raise InvalidInputError("Cancel the eval run before deleting it.")
        for item in self.runs.list_items(run.id):
            self.session.delete(item)
        self.session.delete(run)
        self.session.commit()

    # -- eval collections ---------------------------------------------------------

    def list_eval_collections(self, user: models.User) -> list[EvalCollectionRead]:
        """Return the user's provisioned eval collections with size stats."""
        collections = CollectionRepository(self.session).list_eval_for_user(user.id)
        return [self._to_eval_collection(collection) for collection in collections]

    def delete_eval_collection(self, user: models.User, collection_id: UUID) -> None:
        """Purge one eval collection (vectors, files, rows) to reclaim space."""
        collection = CollectionRepository(self.session).get(collection_id, user.id)
        if collection is None or collection.system_purpose != "eval":
            raise NotFoundError("Eval collection not found.")
        CollectionDeletionService(self.session).delete(user, collection)

    def _to_eval_collection(self, collection: models.Collection) -> EvalCollectionRead:
        """Shape one eval collection row for the management page."""
        documents = select(func.count(col(models.Document.id))).where(  # pylint: disable=not-callable
            col(models.Document.collection_id) == collection.id
        )
        chunks = select(func.count(col(models.DocumentChunkRecord.id))).where(  # pylint: disable=not-callable
            col(models.DocumentChunkRecord.collection_id) == collection.id
        )
        dataset_ref = collection.extra_metadata.get("eval_dataset_id")
        return EvalCollectionRead(
            id=collection.id,
            name=collection.name,
            dataset_id=UUID(dataset_ref) if isinstance(dataset_ref, str) else None,
            ingestion_pipeline_id=collection.ingestion_pipeline_id,
            num_documents=self.session.exec(documents).one(),
            num_chunks=self.session.exec(chunks).one(),
            created_at=collection.created_at,
            updated_at=collection.updated_at,
        )

    def _require_pipeline(
        self, user: models.User, pipeline_id: UUID, kind: models.PipelineKind
    ) -> models.Pipeline:
        """Return a user-owned pipeline of the given kind or raise a 400."""
        pipeline = PipelineService(self.session).get_pipeline(pipeline_id, user.id)
        if pipeline is None or pipeline.kind != kind:
            raise InvalidInputError(f"Invalid {kind.value} pipeline selection.")
        return pipeline
