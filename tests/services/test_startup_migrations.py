"""The startup migration sequence against an ordinary current-shape database.

Every step is pinned individually by its own module's tests; what this file
defends is the property of the *sequence*: it completes, and running it twice
changes nothing. Startup runs it on every boot, so a step that is not
idempotent corrupts rows on the second start rather than the first — and a
step that raises takes the whole process down in `lifespan`, where no retry
helps.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlmodel import Session, select

from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.services.startup_migrations import run_startup_migrations


def _seed_current_shape(session: Session) -> models.Pipeline:
    """A user, collection, and bound pipeline as today's code writes them."""
    user = models.User(
        email=f"startup-{uuid4().hex[:8]}@example.com",
        full_name="Startup",
        hashed_password="x",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    collection = models.Collection(
        user_id=user.id, name="Current", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    pipeline = models.Pipeline(user_id=user.id, name="Current")
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)

    definition = build_default_ingestion_pipeline(
        embedding_connection_id=uuid4(),
        embedding_model="text-embedding-3-small",
        index_name="startup-index",
    )
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=definition.model_dump(mode="json"),
        )
    )
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.INGEST,
        )
    )
    session.commit()
    return pipeline


def _stored_definition(session: Session, pipeline_id: UUID) -> dict[str, object]:
    """Read a pipeline's stored definition back through a fresh session."""
    with Session(session.get_bind()) as fresh:
        version = fresh.exec(
            select(models.PipelineVersion).where(
                models.PipelineVersion.pipeline_id == pipeline_id
            )
        ).one()
        return dict(version.definition)


def test_startup_migrations_leave_a_current_database_unchanged(
    session: Session,
) -> None:
    """A database already on the current shape survives the sequence intact."""
    pipeline = _seed_current_shape(session)
    original = _stored_definition(session, pipeline.id)

    run_startup_migrations(session)

    assert _stored_definition(session, pipeline.id) == original


def test_startup_migrations_are_idempotent(session: Session) -> None:
    """Running the sequence twice writes nothing the first run did not."""
    pipeline = _seed_current_shape(session)

    run_startup_migrations(session)
    once = _stored_definition(session, pipeline.id)

    run_startup_migrations(session)

    assert _stored_definition(session, pipeline.id) == once
