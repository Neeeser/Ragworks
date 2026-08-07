"""Builtin benchmark import: the downloading → ready/failed dataset lifecycle."""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.db import models
from app.evals.dataset_download import run_dataset_download
from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.evals.service import EvalService
from app.schemas.enums import EvalDatasetStatus
from app.services.errors import ExternalServiceError, NotFoundError


def _user(session: Session) -> models.User:
    user = models.User(email="imports@example.com", full_name="I", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _triple() -> DatasetTriple:
    return DatasetTriple(
        name="SciFact",
        corpus=[CorpusDoc(external_doc_id="d1", text="alpha", title="T")],
        queries=[QueryRecord(external_query_id="q1", text="what is alpha")],
        qrels=[Qrel(query_external_id="q1", doc_external_id="d1")],
    )


def test_import_builtin_records_downloading_intent(session: Session) -> None:
    """Importing a known key lands a `downloading` row with registry counts."""
    dataset = EvalService(session).import_builtin(_user(session), "scifact", None)
    assert dataset.status == EvalDatasetStatus.DOWNLOADING.value
    assert dataset.source_ref == "scifact"
    assert dataset.num_queries > 0


def test_import_builtin_rejects_unknown_key(session: Session) -> None:
    """An unknown benchmark key is a NotFoundError before any row is written."""
    with pytest.raises(NotFoundError):
        EvalService(session).import_builtin(_user(session), "nope", None)


def test_background_download_persists_the_triple(session: Session, monkeypatch) -> None:
    """The background download parses and stores the triple, flipping to ready."""
    user = _user(session)
    dataset = EvalService(session).import_builtin(user, "scifact", None)
    monkeypatch.setattr(
        "app.evals.dataset_download.download_builtin", lambda _entry, **_kwargs: _triple()
    )
    monkeypatch.setattr("app.evals.dataset_download.session_scope", lambda: _scope(session))

    run_dataset_download(dataset.id)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalDataset, dataset.id)
        assert stored is not None
        assert stored.status == EvalDatasetStatus.READY.value
        assert stored.num_corpus_docs == 1
        queries = fresh.exec(
            select(models.EvalDatasetQuery).where(models.EvalDatasetQuery.dataset_id == dataset.id)
        ).all()
        assert [q.external_query_id for q in queries] == ["q1"]


def test_download_progress_is_committed_as_pages_land(session: Session, monkeypatch) -> None:
    """A page-image import reports its corpus arriving while it is still running.

    The catalog polls the row, so progress that is only committed at the end
    leaves a multi-minute import looking stalled.
    """
    user = _user(session)
    dataset = EvalService(session).import_builtin(user, "scifact", None)
    seen: list[tuple[int, int]] = []

    def _download(_entry, *, on_progress=None, **_kwargs) -> DatasetTriple:
        assert on_progress is not None
        on_progress(100, 452)
        with Session(session.get_bind()) as fresh:
            row = fresh.get(models.EvalDataset, dataset.id)
            assert row is not None
            seen.append((row.progress_done, row.progress_total))
        return _triple()

    monkeypatch.setattr("app.evals.dataset_download.download_builtin", _download)
    monkeypatch.setattr("app.evals.dataset_download.session_scope", lambda: _scope(session))

    run_dataset_download(dataset.id)

    assert seen == [(100, 452)]


def test_background_download_failure_lands_failed_status(session: Session, monkeypatch) -> None:
    """A download error is recorded on the row, never raised to the worker."""
    user = _user(session)
    dataset = EvalService(session).import_builtin(user, "scifact", None)

    def _boom(_entry, **_kwargs) -> DatasetTriple:
        raise ExternalServiceError("host unreachable")

    monkeypatch.setattr("app.evals.dataset_download.download_builtin", _boom)
    monkeypatch.setattr("app.evals.dataset_download.session_scope", lambda: _scope(session))

    run_dataset_download(dataset.id)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalDataset, dataset.id)
        assert stored is not None
        assert stored.status == EvalDatasetStatus.FAILED.value
        assert stored.error_message is not None
        assert "unreachable" in stored.error_message


class _scope:
    """Context manager handing back the test session as a session_scope."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def __enter__(self) -> Session:
        return self._session

    def __exit__(self, *args: object) -> None:
        return None
