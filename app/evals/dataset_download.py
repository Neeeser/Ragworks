"""Background download of one curated benchmark into its dataset row.

Split from `EvalService` because an image benchmark is a long job with its own
concerns: it writes bytes through a `DatasetMediaStore` bound to the dataset,
and it records progress per page so the catalog can show a corpus arriving over
minutes rather than a row that sits at `downloading` with nothing to report.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.engine import session_scope
from app.evals.datasets.builtin import download_builtin, get_builtin
from app.evals.datasets.hf_datasets_server import ProgressCallback
from app.evals.datasets.media import DatasetMediaStore
from app.evals.service import EvalService
from app.schemas.enums import EvalDatasetStatus
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)


def run_dataset_download(dataset_id: UUID) -> None:
    """Background-task entry point: download one builtin benchmark, never raise.

    Runs once per dataset, scheduled by `EvalService.import_builtin` against
    the id it just minted, and returns immediately unless that row is still
    `downloading`. A failure therefore ends the import: the row is left
    `failed` holding whatever media had already been fetched, addressed by the
    dataset id so deleting the dataset purges it. Fetching the rest needs a
    fresh import.
    """
    with session_scope() as session:
        dataset = session.get(models.EvalDataset, dataset_id)
        if dataset is None or dataset.status != EvalDatasetStatus.DOWNLOADING.value:
            return
        store = DatasetMediaStore(FileStorage(), dataset.id)
        try:
            entry = get_builtin(dataset.source_ref or "")
            triple = download_builtin(
                entry,
                write_media=store.write,
                on_progress=_progress_recorder(session, dataset),
            )
            EvalService(session).persist_triple(dataset, triple)
        except Exception as exc:
            # Deliberately broad: the FAILED dataset row is the outcome a
            # background task records; there is no caller left to re-raise to.
            logger.exception("Benchmark download failed for dataset %s", dataset_id)
            dataset.status = EvalDatasetStatus.FAILED.value
            dataset.error_message = str(exc) or exc.__class__.__name__
            session.add(dataset)
            session.commit()


def _progress_recorder(session: Session, dataset: models.EvalDataset) -> ProgressCallback:
    """Persist corpus-fetch progress as each page lands.

    Committing per page is the point: an image import runs for minutes, and
    the polling catalog can only report what is already in the database.
    """

    def record(done: int, total: int) -> None:
        dataset.progress_done = done
        dataset.progress_total = total
        session.add(dataset)
        session.commit()

    return record
