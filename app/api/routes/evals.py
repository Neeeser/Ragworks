"""Eval API routes: datasets, runs, metric catalog, and eval collections."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.evals.execution.runner import run_eval
from app.evals.service import EvalService, run_dataset_download
from app.evals.wire import to_dataset_read, to_run_item_read, to_run_read, to_run_summary
from app.schemas.evals import (
    BuiltinDatasetInfo,
    EvalCollectionRead,
    EvalDatasetRead,
    EvalMetricInfo,
    EvalRunCreate,
    EvalRunItemsResponse,
    EvalRunRead,
    EvalRunSummary,
    ImportBuiltinDatasetRequest,
    UploadDatasetRequest,
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
    """Parse and store an uploaded BEIR-format golden dataset."""
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
    """List the user's eval runs."""
    return [to_run_summary(run) for run in EvalService(session).list_runs(current_user)]


@router.get("/runs/{run_id}", response_model=EvalRunRead)
def get_run(
    run_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EvalRunRead:
    """Return one run with progress, aggregates, and the funnel."""
    try:
        return to_run_read(EvalService(session).get_run(current_user, run_id))
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
    return EvalService(session).list_eval_collections(current_user)


@router.delete("/collections/{collection_id}", status_code=204)
def delete_eval_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Purge one eval collection to reclaim space."""
    try:
        EvalService(session).delete_eval_collection(current_user, collection_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
