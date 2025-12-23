from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.routes import pipelines as pipelines_routes
from app.db import models
from app.db.repositories import UserRepository
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.services.pipelines import PipelineService


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(email="pipelines@example.com", full_name="Pipelines User", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_pipeline(session: Session, user: models.User) -> models.Pipeline:
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    session.commit()
    session.refresh(pipeline)
    return pipeline


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


def test_delete_pipeline_missing(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        pipelines_routes.delete_pipeline(uuid4(), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_delete_pipeline_blocks_in_use(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)
    _create_collection(session, user, ingestion_pipeline_id=pipeline.id)

    with pytest.raises(HTTPException) as excinfo:
        pipelines_routes.delete_pipeline(pipeline.id, current_user=user, session=session)

    assert excinfo.value.status_code == 409


def test_delete_pipeline_removes_versions(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    response = pipelines_routes.delete_pipeline(pipeline.id, current_user=user, session=session)

    assert response.status == "deleted"
    assert session.get(models.Pipeline, pipeline.id) is None
    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()
    assert len(versions) == 0
