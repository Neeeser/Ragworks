"""EvalService lifecycle behavior: datasets, run validation, cancellation."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.evals.service import EvalService
from app.schemas.enums import EvalDatasetStatus, EvalRunStatus
from app.schemas.evals import EvalRunConfig, EvalRunCreate
from app.services.errors import InvalidInputError, NotFoundError
from tests.utils.providers import install_default_pipelines

CORPUS = '{"_id": "d1", "title": "T", "text": "alpha"}\n'
QUERIES = '{"_id": "q1", "text": "what is alpha"}\n'
QRELS = "q1\td1\t1\n"


def _user(session: Session, email: str = "svc@example.com", *, pipelines: bool = False) -> models.User:
    user = models.User(email=email, full_name="Svc", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    if pipelines:
        install_default_pipelines(session, user)
    return user


def _upload(service: EvalService, user: models.User) -> models.EvalDataset:
    return service.upload_dataset(
        user, name="Golden", corpus=CORPUS, queries=QUERIES, qrels=QRELS
    )


def _config() -> EvalRunConfig:
    return EvalRunConfig(num_queries=1, distractor_pool_size=0)


def test_upload_dataset_persists_the_triple_and_marks_ready(session: Session) -> None:
    """An uploaded dataset lands ready with its rows persisted."""
    service = EvalService(session)
    user = _user(session)
    dataset = _upload(service, user)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalDataset, dataset.id)
        assert stored is not None
        assert stored.status == EvalDatasetStatus.READY.value
        assert stored.num_queries == 1
        assert stored.num_corpus_docs == 1
        docs = fresh.exec(
            select(models.EvalDatasetDocument).where(
                models.EvalDatasetDocument.dataset_id == dataset.id
            )
        ).all()
        assert [doc.external_doc_id for doc in docs] == ["d1"]


def test_dataset_ownership_is_enforced(session: Session) -> None:
    """Another user's dataset reads as not-found."""
    service = EvalService(session)
    owner = _user(session, "owner-a@example.com")
    other = _user(session, "owner-b@example.com")
    dataset = _upload(service, owner)
    with pytest.raises(NotFoundError):
        service.get_dataset(other, dataset.id)


def test_delete_dataset_blocked_while_runs_reference_it(session: Session) -> None:
    """Dataset deletion is refused until its runs are deleted."""
    service = EvalService(session)
    user = _user(session, pipelines=True)
    dataset = _upload(service, user)
    run = service.create_run(
        user,
        EvalRunCreate(
            dataset_id=dataset.id,
            ingestion_pipeline_id=_pipeline_id(session, user, models.PipelineKind.INGESTION),
            retrieval_pipeline_id=_pipeline_id(session, user, models.PipelineKind.RETRIEVAL),
            config=_config(),
        ),
    )
    with pytest.raises(InvalidInputError):
        service.delete_dataset(user, dataset.id)
    service.cancel_run(user, run.id)
    service.delete_run(user, run.id)
    service.delete_dataset(user, dataset.id)
    with Session(session.get_bind()) as fresh:
        assert fresh.get(models.EvalDataset, dataset.id) is None


def test_create_run_rejects_wrong_pipeline_kind(session: Session) -> None:
    """A retrieval pipeline in the ingestion slot is an input error."""
    service = EvalService(session)
    user = _user(session, pipelines=True)
    dataset = _upload(service, user)
    retrieval_id = _pipeline_id(session, user, models.PipelineKind.RETRIEVAL)
    with pytest.raises(InvalidInputError):
        service.create_run(
            user,
            EvalRunCreate(
                dataset_id=dataset.id,
                ingestion_pipeline_id=retrieval_id,
                retrieval_pipeline_id=retrieval_id,
                config=_config(),
            ),
        )


def test_create_run_rejects_unknown_metric_names(session: Session) -> None:
    """A typo'd metric is a 400 at create time, not a failed run hours later.

    Without this gate the run provisions and ingests the whole corpus before
    the first score_query call raises in a background task.
    """
    service = EvalService(session)
    user = _user(session, pipelines=True)
    dataset = _upload(service, user)
    with pytest.raises(InvalidInputError, match="Unknown metric"):
        service.create_run(
            user,
            EvalRunCreate(
                dataset_id=dataset.id,
                ingestion_pipeline_id=_pipeline_id(session, user, models.PipelineKind.INGESTION),
                retrieval_pipeline_id=_pipeline_id(session, user, models.PipelineKind.RETRIEVAL),
                config=EvalRunConfig(
                    num_queries=1, distractor_pool_size=0, selected_metrics=["recal"]
                ),
            ),
        )


def test_create_run_rejects_missing_dataset(session: Session) -> None:
    """A run against a nonexistent dataset is not-found."""
    service = EvalService(session)
    user = _user(session, pipelines=True)
    with pytest.raises(NotFoundError):
        service.create_run(
            user,
            EvalRunCreate(
                dataset_id=uuid4(),
                ingestion_pipeline_id=uuid4(),
                retrieval_pipeline_id=uuid4(),
                config=_config(),
            ),
        )


def test_cancel_only_applies_to_inflight_runs(session: Session) -> None:
    """Cancel flips a pending run; a second cancel is rejected."""
    service = EvalService(session)
    user = _user(session, pipelines=True)
    dataset = _upload(service, user)
    run = service.create_run(
        user,
        EvalRunCreate(
            dataset_id=dataset.id,
            ingestion_pipeline_id=_pipeline_id(session, user, models.PipelineKind.INGESTION),
            retrieval_pipeline_id=_pipeline_id(session, user, models.PipelineKind.RETRIEVAL),
            config=_config(),
        ),
    )
    cancelled = service.cancel_run(user, run.id)
    assert cancelled.status == EvalRunStatus.CANCELLED.value
    with pytest.raises(InvalidInputError):
        service.cancel_run(user, run.id)


def test_delete_eval_collection_never_touches_user_collections(session: Session) -> None:
    """A normal collection is invisible to the eval-collection delete path."""
    service = EvalService(session)
    user = _user(session, "collections@example.com")
    collection = models.Collection(user_id=user.id, name="Mine", extra_metadata={})
    session.add(collection)
    session.commit()
    with pytest.raises(NotFoundError):
        service.delete_eval_collection(user, collection.id)


def _pipeline_id(session: Session, user: models.User, kind: models.PipelineKind):
    return session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id, models.Pipeline.kind == kind
        )
    ).one().id
