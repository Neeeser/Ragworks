"""Eval API routes: datasets, runs, metric catalog, and eval collections."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.evals.collections import EvalCollectionService
from app.evals.dataset_queries import DatasetQueryService
from app.evals.execution.runner import run_eval
from app.evals.generation import run_dataset_generation
from app.evals.generation.requests import create_generation_dataset
from app.evals.service import EvalService, run_dataset_download
from app.evals.wire import to_dataset_read, to_run_item_read, to_run_read, to_run_summary
from app.schemas.evals import (
    BuiltinDatasetInfo,
    EvalCollectionDocumentsPage,
    EvalCollectionRead,
    EvalDatasetDocumentRead,
    EvalDatasetRead,
    EvalMetricInfo,
    EvalRunCreate,
    EvalRunItemsResponse,
    EvalRunRead,
    EvalRunSummary,
    ImportBuiltinDatasetRequest,
    UploadDatasetRequest,
)
from app.schemas.evals_generation import (
    EvalDatasetGenerateRequest,
    EvalDatasetQueriesPage,
    EvalDatasetQueryRead,
    EvalDatasetQueryUpdate,
)
from app.services.errors import ServiceError

router = APIRouter(prefix="/api/evals", tags=["evals"])


@router.get("/benchmarks", response_model=list[BuiltinDatasetInfo])
def list_benchmarks(
    _current_user: models.User = Depends(get_current_user),
) -> list[BuiltinDatasetInfo]:
    """Return the curated benchmark registry."""
    return EvalService.builtin_catalog()


@router.get("/metrics", response_model=list[EvalMetricInfo])
def list_metric_catalog(
    _current_user: models.User = Depends(get_current_user),
) -> list[EvalMetricInfo]:
    """Return every registered metric with its description."""
    return EvalService.metric_catalog()


@router.get("/datasets", response_model=list[EvalDatasetRead])
def list_datasets(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EvalDatasetRead]:
    """List the user's eval datasets."""
    return [to_dataset_read(row) for row in EvalService(session).list_datasets(current_user)]


@router.post("/datasets/import", response_model=EvalDatasetRead, status_code=202)
def import_builtin_dataset(
    payload: ImportBuiltinDatasetRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetRead:
    """Record a benchmark import and download it in the background."""
    try:
        dataset = EvalService(session).import_builtin(current_user, payload.key, payload.name)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    background_tasks.add_task(run_dataset_download, dataset.id)
    return to_dataset_read(dataset)


@router.post("/datasets/upload", response_model=EvalDatasetRead, status_code=201)
def upload_dataset(
    payload: UploadDatasetRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetRead:
    """Parse and store an uploaded BEIR-format dataset."""
    try:
        dataset = EvalService(session).upload_dataset(
            current_user,
            name=payload.name,
            corpus=payload.corpus,
            queries=payload.queries,
            qrels=payload.qrels,
            description=payload.description,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return to_dataset_read(dataset)


@router.post("/datasets/generate", response_model=EvalDatasetRead, status_code=202)
def generate_dataset(
    payload: EvalDatasetGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetRead:
    """Record a synthetic dataset and generate it in the background."""
    try:
        dataset = create_generation_dataset(session, current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    background_tasks.add_task(run_dataset_generation, dataset.id)
    return to_dataset_read(dataset)


@router.get("/datasets/{dataset_id}/queries", response_model=EvalDatasetQueriesPage)
def list_dataset_queries(
    dataset_id: UUID,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetQueriesPage:
    """Page one dataset's queries with gold references and generation metadata."""
    try:
        return DatasetQueryService(session).list_queries(
            current_user, dataset_id, offset=offset, limit=limit
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.patch(
    "/datasets/{dataset_id}/queries/{query_id}", response_model=EvalDatasetQueryRead
)
def update_dataset_query(
    dataset_id: UUID,
    query_id: UUID,
    payload: EvalDatasetQueryUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetQueryRead:
    """Edit one dataset query's text (gold labels unchanged)."""
    try:
        return DatasetQueryService(session).update_query_text(
            current_user, dataset_id, query_id, payload.text
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/datasets/{dataset_id}/queries/{query_id}", status_code=204)
def delete_dataset_query(
    dataset_id: UUID,
    query_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete one dataset query and its relevance judgments."""
    try:
        DatasetQueryService(session).delete_query(current_user, dataset_id, query_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/datasets/{dataset_id}", response_model=EvalDatasetRead)
def get_dataset(
    dataset_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetRead:
    """Return one user-owned dataset."""
    try:
        return to_dataset_read(EvalService(session).get_dataset(current_user, dataset_id))
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(
    dataset_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete a dataset with no runs referencing it."""
    try:
        EvalService(session).delete_dataset(current_user, dataset_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("/runs", response_model=EvalRunRead, status_code=202)
def create_run(
    payload: EvalRunCreate,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalRunRead:
    """Create an eval run and execute it in the background."""
    try:
        run = EvalService(session).create_run(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    background_tasks.add_task(run_eval, run.id)
    return to_run_read(run)


@router.get("/runs", response_model=list[EvalRunSummary])
def list_runs(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EvalRunSummary]:
    """List the user's eval runs with dataset-coverage indicators."""
    service = EvalService(session)
    runs = service.list_runs(current_user)
    coverage = service.coverage_for(runs)
    return [to_run_summary(run, coverage.get(run.id)) for run in runs]


@router.get("/runs/{run_id}", response_model=EvalRunRead)
def get_run(
    run_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalRunRead:
    """Return one run with progress, aggregates, funnel, and coverage."""
    try:
        service = EvalService(session)
        run = service.get_run(current_user, run_id)
        return to_run_read(run, service.coverage_for([run]).get(run.id))
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/runs/{run_id}/items", response_model=EvalRunItemsResponse)
def list_run_items(
    run_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalRunItemsResponse:
    """Return the per-query results for one run, with document display titles."""
    try:
        items, titles = EvalService(session).list_run_items(current_user, run_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return EvalRunItemsResponse(
        items=[to_run_item_read(item) for item in items],
        document_titles=titles,
    )


@router.post("/runs/{run_id}/cancel", response_model=EvalRunRead)
def cancel_run(
    run_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalRunRead:
    """Request cooperative cancellation of an in-flight run."""
    try:
        return to_run_read(EvalService(session).cancel_run(current_user, run_id))
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(
    run_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete a finished run and its items."""
    try:
        EvalService(session).delete_run(current_user, run_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/collections", response_model=list[EvalCollectionRead])
def list_eval_collections(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EvalCollectionRead]:
    """List provisioned eval collections for the management page."""
    return EvalCollectionService(session).list_eval_collections(current_user)


@router.get("/collections/{collection_id}/documents", response_model=EvalCollectionDocumentsPage)
def list_eval_collection_documents(
    collection_id: UUID,
    search: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalCollectionDocumentsPage:
    """Page one eval collection's documents with their ingestion outcomes."""
    try:
        return EvalCollectionService(session).list_collection_documents(
            current_user, collection_id, search=search, offset=offset, limit=limit
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get(
    "/datasets/{dataset_id}/documents/{external_doc_id}",
    response_model=EvalDatasetDocumentRead,
)
def get_dataset_document(
    dataset_id: UUID,
    external_doc_id: str,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalDatasetDocumentRead:
    """Return one corpus document's stored source text."""
    try:
        return EvalService(session).get_dataset_document(
            current_user, dataset_id, external_doc_id
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/collections/{collection_id}", status_code=204)
def delete_eval_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Purge one eval collection to reclaim space."""
    try:
        EvalCollectionService(session).delete_eval_collection(current_user, collection_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
