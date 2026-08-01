"""Staleness of ready documents against the bound ingestion pipeline."""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.schemas.enums import BindingRole, DocumentStatus, PipelineRunStatus
from app.services.file_staleness import IngestionStaleness, mark_stale_documents_pending


def _seed_user(session: Session) -> models.User:
    user = models.User(
        email=f"stale-{uuid4().hex[:8]}@example.com",
        full_name="Stale Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _seed_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _seed_pipeline(
    session: Session, user: models.User, collection: models.Collection, version: int
) -> models.Pipeline:
    pipeline = models.Pipeline(user_id=user.id, name="Ingest", current_version=version)
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=BindingRole.INGEST,
        )
    )
    session.commit()
    return pipeline


def _seed_document(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    status: DocumentStatus = DocumentStatus.READY,
    run: models.PipelineRun | None = None,
) -> models.Document:
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=status,
        embedding_model="",
        ingestion_run_id=run.id if run else None,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def _seed_run(
    session: Session,
    user: models.User,
    collection: models.Collection,
    pipeline: models.Pipeline,
    version: int | None,
) -> models.PipelineRun:
    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version=version,
        trigger=BindingRole.INGEST,
        user_id=user.id,
        collection_id=collection.id,
        status=PipelineRunStatus.COMPLETED,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def test_document_from_older_pipeline_version_is_stale(session: Session) -> None:
    user = _seed_user(session)
    collection = _seed_collection(session, user)
    pipeline = _seed_pipeline(session, user, collection, version=3)
    run = _seed_run(session, user, collection, pipeline, version=2)
    document = _seed_document(session, user, collection, run=run)

    staleness = IngestionStaleness(session, collection.id)
    assert staleness.stale_document_ids([document]) == {document.id}


def test_document_from_current_version_is_not_stale(session: Session) -> None:
    user = _seed_user(session)
    collection = _seed_collection(session, user)
    pipeline = _seed_pipeline(session, user, collection, version=3)
    run = _seed_run(session, user, collection, pipeline, version=3)
    document = _seed_document(session, user, collection, run=run)

    assert IngestionStaleness(session, collection.id).stale_document_ids([document]) == set()


def test_document_from_a_different_pipeline_is_stale(session: Session) -> None:
    user = _seed_user(session)
    collection = _seed_collection(session, user)
    _seed_pipeline(session, user, collection, version=1)
    other = models.Pipeline(user_id=user.id, name="Old ingest", current_version=1)
    session.add(other)
    session.commit()
    session.refresh(other)
    run = _seed_run(session, user, collection, other, version=1)
    document = _seed_document(session, user, collection, run=run)

    staleness = IngestionStaleness(session, collection.id)
    assert staleness.stale_document_ids([document]) == {document.id}


def test_documents_without_run_lineage_or_binding_are_never_stale(
    session: Session,
) -> None:
    user = _seed_user(session)
    collection = _seed_collection(session, user)
    no_run = _seed_document(session, user, collection)
    assert IngestionStaleness(session, collection.id).stale_document_ids([no_run]) == set()

    pipeline = _seed_pipeline(session, user, collection, version=2)
    assert IngestionStaleness(session, collection.id).stale_document_ids([no_run]) == set()

    versionless_run = _seed_run(session, user, collection, pipeline, version=None)
    unknown = _seed_document(session, user, collection, run=versionless_run)
    staleness = IngestionStaleness(session, collection.id)
    assert staleness.stale_document_ids([no_run, unknown]) == set()


def test_non_ready_documents_are_not_stale(session: Session) -> None:
    user = _seed_user(session)
    collection = _seed_collection(session, user)
    pipeline = _seed_pipeline(session, user, collection, version=2)
    run = _seed_run(session, user, collection, pipeline, version=1)
    failed = _seed_document(
        session, user, collection, status=DocumentStatus.FAILED, run=run
    )
    assert IngestionStaleness(session, collection.id).stale_document_ids([failed]) == set()


def test_mark_stale_documents_pending_resets_only_stale_rows(session: Session) -> None:
    user = _seed_user(session)
    collection = _seed_collection(session, user)
    pipeline = _seed_pipeline(session, user, collection, version=2)
    old_run = _seed_run(session, user, collection, pipeline, version=1)
    current_run = _seed_run(session, user, collection, pipeline, version=2)
    stale = _seed_document(session, user, collection, run=old_run)
    fresh = _seed_document(session, user, collection, run=current_run)

    queued = mark_stale_documents_pending(session, collection)
    session.commit()
    assert queued == [stale.id]

    with Session(session.get_bind()) as fresh_session:
        stale_row = fresh_session.get(models.Document, stale.id)
        fresh_row = fresh_session.get(models.Document, fresh.id)
        assert stale_row is not None
        assert stale_row.status == DocumentStatus.PENDING
        assert fresh_row is not None
        assert fresh_row.status == DocumentStatus.READY
