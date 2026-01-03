from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.services.retrieval import RetrievalService
from app.services.pipelines import PipelineService


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="retrieval@example.com",
        full_name="Retrieval User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User, *, retrieval_pipeline_id=None) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        retrieval_pipeline_id=retrieval_pipeline_id,
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_query_collection_rejects_missing_pipeline(session: Session) -> None:
    user = _create_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    session.commit()
    collection = _create_collection(session, user, retrieval_pipeline_id=pipeline.id)
    service = RetrievalService(session)

    with pytest.raises(ValueError, match="Retrieval pipeline could not be resolved"):
        service.query_collection(user, collection, query="hello")


def test_query_collection_marks_run_failed_on_exception(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    collection.retrieval_pipeline_id = defaults.retrieval.id
    session.add(collection)
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, _context):
            raise RuntimeError("boom")

    monkeypatch.setattr("app.services.retrieval.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.retrieval.get_openrouter_client", lambda *_args, **_kwargs: object())
    monkeypatch.setattr("app.services.retrieval.get_pinecone_client", lambda *_args, **_kwargs: object())

    with pytest.raises(RuntimeError, match="boom"):
        service.query_collection(user, collection, query="hello")

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "boom"


def test_query_collection_skips_failed_run_update(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    collection.retrieval_pipeline_id = defaults.retrieval.id
    session.add(collection)
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, context):
            context.trace._run.status = models.PipelineRunStatus.FAILED
            raise RuntimeError("boom")

    monkeypatch.setattr("app.services.retrieval.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.retrieval.get_openrouter_client", lambda *_args, **_kwargs: object())
    monkeypatch.setattr("app.services.retrieval.get_pinecone_client", lambda *_args, **_kwargs: object())

    with pytest.raises(RuntimeError, match="boom"):
        service.query_collection(user, collection, query="hello")

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_extract_retrieval_payload_raises_for_missing_result() -> None:
    with pytest.raises(ValueError, match="retrieval result payload"):
        RetrievalService._extract_retrieval_payload({"node": {"data": {}}})


def test_usage_tokens_prefers_known_keys() -> None:
    assert RetrievalService._usage_tokens({"total_tokens": 5}) == 5
    assert RetrievalService._usage_tokens({"prompt_tokens": 3}) == 3
    assert RetrievalService._usage_tokens({"input_tokens": 4}) == 4
    assert RetrievalService._usage_tokens({"other": 2, "extra": 3}) == 5
