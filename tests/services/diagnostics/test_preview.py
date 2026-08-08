"""Pre-creation diagnostics: the preview must agree with the persisted run.

These build real pipelines against the test Postgres and compare what the
preview reports for a pairing with what `CollectionDiagnosticsService.run`
reports once a collection with that same pairing exists.
"""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.schemas.diagnostics import CollectionDiagnosticsPreviewRequest
from app.services.diagnostics import CollectionDiagnosticsService
from app.services.diagnostics.preview import EXCLUDED_PREVIEW_RULES, PREVIEW_RULES
from app.services.diagnostics.rules.registry import DIAGNOSTIC_RULES
from app.services.pipelines import PipelineService
from tests.utils.providers import add_openrouter_connection


def _user(session: Session) -> models.User:
    user = models.User(email="preview@example.com", full_name="Preview", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _pipelines(
    session: Session,
    user: models.User,
    *,
    ingest_model: str,
    retrieval_model: str,
) -> tuple[models.Pipeline, models.Pipeline]:
    """Create one ingestion and one retrieval pipeline with the given models."""
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
    return ingestion, retrieval


def _create_collection(
    session: Session,
    user: models.User,
    ingestion: models.Pipeline,
    tools: list[models.Pipeline],
) -> models.Collection:
    """Persist a collection bound to the same pipelines the preview was given."""
    collection = models.Collection(
        user_id=user.id, name="Docs", description="", extra_metadata={}
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
    for position, tool in enumerate(tools):
        session.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=tool.id,
                role=models.BindingRole.TOOL,
                is_primary=position == 0,
                position=position,
            )
        )
    session.commit()
    return collection


def test_preview_flags_the_mismatch_the_created_collection_would(session: Session):
    """A broken pairing flags pre-creation with the same finding it does after."""
    user = _user(session)
    ingestion, retrieval = _pipelines(
        session, user, ingest_model="model-a", retrieval_model="model-b"
    )
    service = CollectionDiagnosticsService(session)

    preview = service.preview(
        user,
        CollectionDiagnosticsPreviewRequest(
            name="Docs",
            ingest_pipeline_id=ingestion.id,
            tool_pipeline_ids=[retrieval.id],
        ),
    )

    collection = _create_collection(session, user, ingestion, [retrieval])
    persisted = service.run(user, collection)

    assert "embedding_model_mismatch" in {d.code for d in preview.diagnostics}
    assert preview.consistent is False
    mismatch = next(d for d in preview.diagnostics if d.code == "embedding_model_mismatch")
    after = next(d for d in persisted.diagnostics if d.code == "embedding_model_mismatch")
    assert (mismatch.severity, mismatch.summary) == (after.severity, after.summary)
    assert [(o.label, o.ingestion, o.retrieval) for o in mismatch.observations] == [
        (o.label, o.ingestion, o.retrieval) for o in after.observations
    ]


def test_preview_of_a_matched_pairing_is_clean(session: Session):
    """Aligned pipelines produce no embedding finding and stay consistent."""
    user = _user(session)
    ingestion, retrieval = _pipelines(
        session, user, ingest_model="same", retrieval_model="same"
    )

    preview = CollectionDiagnosticsService(session).preview(
        user,
        CollectionDiagnosticsPreviewRequest(
            ingest_pipeline_id=ingestion.id, tool_pipeline_ids=[retrieval.id]
        ),
    )

    assert "embedding_model_mismatch" not in {d.code for d in preview.diagnostics}
    assert preview.consistent is True


def test_preview_flags_two_tools_sharing_a_tool_name(session: Session):
    """Duplicate tool names are a pre-creation finding, not a post-create 400."""
    user = _user(session)
    ingestion, retrieval = _pipelines(
        session, user, ingest_model="same", retrieval_model="same"
    )
    connection = add_openrouter_connection(session, user)
    second = PipelineService(session).create_pipeline(
        user=user,
        name="Second Search",
        description="",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=connection.id, embedding_model="same"
        ),
        change_summary="init",
    )

    preview = CollectionDiagnosticsService(session).preview(
        user,
        CollectionDiagnosticsPreviewRequest(
            ingest_pipeline_id=ingestion.id, tool_pipeline_ids=[retrieval.id, second.id]
        ),
    )

    assert "duplicate_tool_name" in {d.code for d in preview.diagnostics}


def test_preview_persists_nothing(session: Session):
    """The preview creates no collection, binding, or pipeline row."""
    user = _user(session)
    ingestion, retrieval = _pipelines(
        session, user, ingest_model="model-a", retrieval_model="model-b"
    )

    CollectionDiagnosticsService(session).preview(
        user,
        CollectionDiagnosticsPreviewRequest(
            name="Docs",
            ingest_pipeline_id=ingestion.id,
            tool_pipeline_ids=[retrieval.id],
        ),
    )

    with Session(session.get_bind()) as fresh:
        assert CollectionRepository(fresh).list_for_user(user.id) == []


def test_preview_tolerates_an_unresolvable_choice(session: Session):
    """A pipeline id that answers nothing leaves the preview usable, not failed."""
    user = _user(session)
    ingestion, _ = _pipelines(session, user, ingest_model="a", retrieval_model="a")

    preview = CollectionDiagnosticsService(session).preview(
        user,
        CollectionDiagnosticsPreviewRequest(
            ingest_pipeline_id=ingestion.id, tool_pipeline_ids=[uuid4()]
        ),
    )

    assert "embedding_model_mismatch" not in {d.code for d in preview.diagnostics}


def test_excluded_rules_are_named_and_the_rest_run():
    """The preview runs every registered rule except the explicitly excluded ones.

    Pinned so a rule added to the registry is a deliberate include-or-exclude
    decision rather than one silently made by whichever list was edited.
    """
    registry_codes = {rule.code for rule in DIAGNOSTIC_RULES}
    assert set(EXCLUDED_PREVIEW_RULES) <= registry_codes
    assert {rule.code for rule in PREVIEW_RULES} == registry_codes - set(EXCLUDED_PREVIEW_RULES)
    assert set(EXCLUDED_PREVIEW_RULES) == {
        "index_probe",
        "recent_ingestion_failures",
        "recent_retrieval_failures",
    }


def test_preview_never_probes_the_store(session: Session, monkeypatch):
    """No live index probe runs on the wizard's debounced path."""
    user = _user(session)
    ingestion, retrieval = _pipelines(session, user, ingest_model="same", retrieval_model="same")

    def _fail(*args: object, **kwargs: object) -> None:
        raise AssertionError("the preview must not contact the vector store")

    monkeypatch.setattr("app.services.diagnostics.prober.VectorStoreProber.stats", _fail)

    preview = CollectionDiagnosticsService(session).preview(
        user,
        CollectionDiagnosticsPreviewRequest(
            ingest_pipeline_id=ingestion.id, tool_pipeline_ids=[retrieval.id]
        ),
    )

    assert not [d for d in preview.diagnostics if d.code in {"missing_index", "empty_index"}]
