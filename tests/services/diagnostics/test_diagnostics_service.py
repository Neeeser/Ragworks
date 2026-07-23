"""Service-level tests: real pipelines, aggregation, and cache signature.

These build real bound pipelines and drive `CollectionDiagnosticsService`
against the test Postgres, so they exercise read-only resolution, the probe
against pgvector, aggregation, and the cache signature end to end.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.services.diagnostics import CollectionDiagnosticsService
from app.services.pipelines import PipelineService
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
