"""Service-level tests: real pipelines, aggregation, and cache signature.

These build real bound pipelines and drive `CollectionDiagnosticsService`
against the test Postgres, so they exercise read-only resolution, the probe
against pgvector, aggregation, and the cache signature end to end.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.services.diagnostics import CollectionDiagnosticsService
from app.services.diagnostics import context as context_module
from app.services.pipelines import PipelineService
from app.vectorstores.base import IndexStats
from tests.utils.providers import add_openrouter_connection


def _user(session: Session) -> models.User:
    user = models.User(email="diag@example.com", full_name="Diag", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _collection_with_models(
    session: Session,
    user: models.User,
    *,
    ingest_model: str,
    retrieval_model: str,
) -> models.Collection:
    """Create a collection whose two pipelines use the given embedding models."""
    connection = add_openrouter_connection(session, user)
    service = PipelineService(session)
    ingestion = service.create_pipeline(
        user=user,
        name="Ingestion",
        description="",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=connection.id, embedding_model=ingest_model
        ),
        change_summary="init",
    )
    retrieval = service.create_pipeline(
        user=user,
        name="Retrieval",
        description="",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=connection.id, embedding_model=retrieval_model
        ),
        change_summary="init",
    )
    collection = models.Collection(
        user_id=user.id,
        name="Docs",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=ingestion.id,
            role=models.BindingRole.INGEST,
        )
    )
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=retrieval.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()
    return collection


def test_embedding_mismatch_surfaces_and_marks_inconsistent(session: Session):
    """A real mismatched collection reports the flagship error and is inconsistent."""
    user = _user(session)
    collection = _collection_with_models(
        session, user, ingest_model="model-a", retrieval_model="model-b"
    )
    response = CollectionDiagnosticsService(session).run(user, collection)
    codes = {d.code for d in response.diagnostics}
    assert "embedding_model_mismatch" in codes
    assert response.error_count >= 1
    assert response.consistent is False
    assert response.collection_id == collection.id


def test_matched_models_have_no_embedding_error(session: Session):
    """Matching models produce no embedding_model_mismatch finding."""
    user = _user(session)
    collection = _collection_with_models(
        session, user, ingest_model="same", retrieval_model="same"
    )
    response = CollectionDiagnosticsService(session).run(user, collection)
    codes = {d.code for d in response.diagnostics}
    assert "embedding_model_mismatch" not in codes


def test_fresh_collection_reports_no_index_errors(
    session: Session, monkeypatch: pytest.MonkeyPatch
):
    """A collection nobody has ingested into opens clean, not "Issues found".

    The Overview card reads `consistent` + the error count, so indexes that
    only the first ingestion run creates must not register as errors there.
    """
    user = _user(session)
    collection = _collection_with_models(
        session, user, ingest_model="same", retrieval_model="same"
    )

    class _AbsentIndexProber:
        """Stand-in store where no index exists yet (the pre-ingest reality)."""

        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def stats(self, *args: object, **kwargs: object) -> IndexStats:
            return IndexStats(exists=False, count=0)

    monkeypatch.setattr(context_module, "VectorStoreProber", _AbsentIndexProber)

    response = CollectionDiagnosticsService(session).run(user, collection)

    assert response.error_count == 0
    assert response.consistent is True
    index_findings = [
        d for d in response.diagnostics if d.code in {"missing_index", "empty_index"}
    ]
    assert index_findings
    assert all(d.severity == "info" for d in index_findings)


def test_signature_busts_on_pipeline_version_change(session: Session):
    """A new pipeline version changes the cache signature (invalidates the entry)."""
    user = _user(session)
    collection = _collection_with_models(
        session, user, ingest_model="a", retrieval_model="b"
    )
    service = CollectionDiagnosticsService(session)
    before = service._signature(collection)

    from app.db.repositories import CollectionPipelineBindingRepository

    tool_binding = CollectionPipelineBindingRepository(session).list_for_collection(
        collection.id, role=models.BindingRole.TOOL
    )[0]
    pipelines = PipelineService(session)
    retrieval = pipelines.get_pipeline(tool_binding.pipeline_id, user.id)
    assert retrieval is not None
    pipelines.update_pipeline(
        pipeline=retrieval,
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=add_openrouter_connection(session, user).id,
            embedding_model="c",
        ),
        change_summary="bump",
    )
    session.commit()

    after = service._signature(collection)
    assert before != after


def test_ingestion_failure_warning_clears_once_document_is_retried(session: Session):
    """A failed-run warning stops once every affected document is READY again.

    Regression test: `RecentIngestionFailuresRule` used to report every FAILED
    ingestion run in recent history forever, even after the document it named
    was retried and indexed successfully -- a fully-recovered, healthy
    collection kept showing a false "documents were not indexed" warning with
    no way for it to clear.
    """
    user = _user(session)
    collection = _collection_with_models(
        session, user, ingest_model="same", retrieval_model="same"
    )
    ingest_binding = CollectionPipelineBindingRepository(session).list_for_collection(
        collection.id, role=models.BindingRole.INGEST
    )[0]

    failed_run = models.PipelineRun(
        pipeline_id=ingest_binding.pipeline_id,
        trigger=models.BindingRole.INGEST,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.FAILED,
    )
    session.add(failed_run)
    session.commit()
    session.refresh(failed_run)

    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.FAILED,
        embedding_model="",
        ingestion_run_id=failed_run.id,
    )
    session.add(document)
    session.commit()

    response = CollectionDiagnosticsService(session).run(user, collection)
    codes = {d.code for d in response.diagnostics}
    assert "recent_ingestion_failures" in codes

    # Simulate a successful retry exactly as `IngestionService.ingest_document`
    # performs one: a new run, and the document repointed at it and marked
    # READY.
    retry_run = models.PipelineRun(
        pipeline_id=ingest_binding.pipeline_id,
        trigger=models.BindingRole.INGEST,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add(retry_run)
    session.commit()
    session.refresh(retry_run)
    document.ingestion_run_id = retry_run.id
    document.status = models.DocumentStatus.READY
    session.add(document)
    session.commit()

    response = CollectionDiagnosticsService(session).run(user, collection)
    codes = {d.code for d in response.diagnostics}
    assert "recent_ingestion_failures" not in codes
