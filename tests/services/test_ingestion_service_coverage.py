from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline, build_default_retrieval_pipeline
from app.services.pipelines import PipelineService
from app.services.ingestion import IngestionService


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="ingest@example.com",
        full_name="Ingest User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User, *, ingestion_pipeline_id=None) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        ingestion_pipeline_id=ingestion_pipeline_id,
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_resolve_ingestion_pipeline_rejects_missing(session: Session) -> None:
    user = _create_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()
    collection = _create_collection(session, user, ingestion_pipeline_id=pipeline.id)
    service = IngestionService(session)

    with pytest.raises(ValueError, match="Ingestion pipeline could not be resolved"):
        service._resolve_ingestion_pipeline(user, collection)


def test_extract_indexing_payload_raises_for_missing_result() -> None:
    with pytest.raises(ValueError, match="ingestion result payload"):
        IngestionService._extract_indexing_payload({"node": {"data": {}}})


def test_record_failure_updates_run_status(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    session.commit()
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.PROCESSING,
        chunk_size=10,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed",
    )
    session.add(document)
    session.commit()
    session.refresh(document)

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.RUNNING,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    service = IngestionService(session)
    service._record_failure(document, run, RuntimeError("boom"))
    session.commit()

    refreshed_run = session.get(models.PipelineRun, run.id)
    assert refreshed_run is not None
    assert refreshed_run.status == models.PipelineRunStatus.FAILED
    assert refreshed_run.error_message == "boom"


def test_record_failure_skips_failed_run(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    session.commit()

    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.PROCESSING,
        chunk_size=10,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed",
    )
    session.add(document)
    session.commit()

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.FAILED,
        error_message="existing",
    )
    session.add(run)
    session.commit()

    service = IngestionService(session)
    service._record_failure(document, run, RuntimeError("boom"))
    session.commit()

    refreshed_run = session.get(models.PipelineRun, run.id)
    assert refreshed_run is not None
    assert refreshed_run.error_message == "existing"
