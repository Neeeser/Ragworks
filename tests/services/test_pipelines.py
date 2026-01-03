from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.services.pipelines import PipelineService


def _create_user(session: Session) -> models.User:
    user = models.User(email="pipeline@example.com", full_name="Pipeline User", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(
    session: Session,
    user: models.User,
    *,
    ingestion_pipeline_id: UUID | None = None,
    retrieval_pipeline_id: UUID | None = None,
) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        ingestion_pipeline_id=ingestion_pipeline_id,
        retrieval_pipeline_id=retrieval_pipeline_id,
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_ensure_default_pipelines_creates_versions(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)

    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipelines = session.exec(select(models.Pipeline)).all()
    versions = session.exec(select(models.PipelineVersion)).all()

    assert defaults.ingestion.is_default
    assert defaults.retrieval.is_default
    assert len(pipelines) == 2
    assert len(versions) == 2


def test_update_pipeline_creates_new_version(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipeline = defaults.ingestion
    service.update_pipeline(
        pipeline=pipeline,
        definition=build_default_ingestion_pipeline(),
        change_summary="Second revision",
        actor_id=user.id,
    )
    session.commit()

    updated = session.get(models.Pipeline, pipeline.id)
    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()

    assert updated is not None
    assert updated.current_version == 2
    assert len(versions) == 2


def test_update_pipeline_updates_metadata_only(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipeline = defaults.ingestion
    service.update_pipeline(
        pipeline=pipeline,
        name="Updated Name",
        description="Updated description",
    )
    session.commit()

    updated = session.get(models.Pipeline, pipeline.id)
    assert updated is not None
    assert updated.name == "Updated Name"
    assert updated.description == "Updated description"
    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()
    assert len(versions) == 1


def test_activate_version_switches_current(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipeline = defaults.ingestion
    service.update_pipeline(
        pipeline=pipeline,
        definition=build_default_ingestion_pipeline(),
        change_summary="Second revision",
        actor_id=user.id,
    )
    service.activate_version(pipeline, 1)
    session.commit()

    updated = session.get(models.Pipeline, pipeline.id)
    assert updated is not None
    assert updated.current_version == 1


def test_activate_version_raises_when_missing(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    with pytest.raises(ValueError, match="does not exist"):
        service.activate_version(defaults.ingestion, version=999)


def test_pipeline_in_use_detects_collection_reference(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    session.commit()
    _create_collection(session, user, ingestion_pipeline_id=pipeline.id)

    assert service.pipeline_in_use(pipeline.id)


def test_get_current_version_raises_when_missing(session: Session) -> None:
    user = _create_user(session)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.commit()

    service = PipelineService(session)

    with pytest.raises(ValueError, match="no current version"):
        service.get_current_version(pipeline)


def test_delete_pipeline_removes_versions(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    service.update_pipeline(
        pipeline=pipeline,
        definition=build_default_ingestion_pipeline(),
        change_summary="Second revision",
        actor_id=user.id,
    )
    session.commit()

    service.delete_pipeline(pipeline)
    session.commit()

    assert session.get(models.Pipeline, pipeline.id) is None
    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()
    assert len(versions) == 0


def test_ensure_collection_pipelines_sets_defaults(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()
    collection = _create_collection(session, user)

    service.ensure_collection_pipelines(collection, defaults)
    session.commit()

    refreshed = session.get(models.Collection, collection.id)
    assert refreshed is not None
    assert refreshed.ingestion_pipeline_id == defaults.ingestion.id
    assert refreshed.retrieval_pipeline_id == defaults.retrieval.id


def test_backfill_default_pipelines_assigns_for_existing_collection(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    from app.services.pipelines import backfill_default_pipelines

    backfill_default_pipelines(session)
    session.commit()

    refreshed = session.get(models.Collection, collection.id)
    assert refreshed is not None
    assert refreshed.ingestion_pipeline_id is not None
    assert refreshed.retrieval_pipeline_id is not None
