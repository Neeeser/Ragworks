from __future__ import annotations

from uuid import UUID, uuid4

import httpx
import pytest
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import PipelineDefinition, PipelineNodePosition
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipelines import (
    DEFAULT_INGEST_SLUG,
    DEFAULT_SEARCH_SLUG,
    PipelineService,
)
from tests.utils.providers import add_openrouter_connection

EMBED_CONNECTION_ID = uuid4()


def _revised_ingestion_definition() -> PipelineDefinition:
    """Default ingestion definition with a material config change."""
    definition = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
    )
    chunker = next(node for node in definition.nodes if node.id == "chunk-document")
    chunker.config = {**chunker.config, "chunk_size": 256}
    return definition


def _create_user(session: Session) -> models.User:
    """A user with defaults already installed.

    Global default models are gone, so `ensure_default_pipelines` can only
    re-scaffold from existing defaults — these tests install the pair the way
    the setup wizard would (explicit connection + model).
    """
    user = models.User(email="pipeline@example.com", full_name="Pipeline User", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    connection = add_openrouter_connection(session, user)
    service = PipelineService(session)
    service.create_pipeline(
        user=user,
        name="Default Ingestion Pipeline",
        description="Baseline ingestion pipeline for uploads.",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=connection.id, embedding_model="test-embed"
        ),
        change_summary="Test scaffold.",
        template_slug=DEFAULT_INGEST_SLUG,
    )
    service.create_pipeline(
        user=user,
        name="Default Retrieval Pipeline",
        description="Baseline retrieval pipeline for queries.",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=connection.id, embedding_model="test-embed"
        ),
        change_summary="Test scaffold.",
        template_slug=DEFAULT_SEARCH_SLUG,
    )
    session.commit()
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
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    if ingestion_pipeline_id is not None:
        session.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=ingestion_pipeline_id,
                role=models.BindingRole.INGEST,
            )
        )
    if retrieval_pipeline_id is not None:
        session.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=retrieval_pipeline_id,
                role=models.BindingRole.TOOL,
                is_primary=True,
            )
        )
    session.commit()
    return collection


def _binding_pipeline_ids(
    session: Session, collection: models.Collection
) -> dict[str, UUID]:
    """Return the collection's bound pipeline ids keyed by role value."""
    bindings = CollectionPipelineBindingRepository(session).list_for_collection(
        collection.id
    )
    return {models.BindingRole(binding.role).value: binding.pipeline_id for binding in bindings}


def test_ensure_default_pipelines_creates_versions(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)

    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipelines = session.exec(select(models.Pipeline)).all()
    versions = session.exec(select(models.PipelineVersion)).all()

    assert defaults.ingestion.template_slug == DEFAULT_INGEST_SLUG
    assert defaults.retrieval.template_slug == DEFAULT_SEARCH_SLUG
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
        definition=_revised_ingestion_definition(),
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


def test_create_pipeline_rejects_embedding_limit_overflow(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real tokenizer counts reject a chunk window above the model limit."""
    user = _create_user(session)
    model_id = "sentence-transformers/all-minilm-l6-v2"
    definition = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID,
        embedding_model=model_id,
        chunk_size=1024,
    )
    service = PipelineService(
        session,
        embedding_input_limit=lambda _connection_id, _model: 512,
    )

    validation_results = []
    original_validate_definition = service.validate_definition

    def capture_validation(*args: object, **kwargs: object):
        result = original_validate_definition(*args, **kwargs)
        validation_results.append(result)
        return result

    monkeypatch.setattr(service, "validate_definition", capture_validation)
    with pytest.raises(InvalidInputError):
        service.create_pipeline(
            user=user,
            name="Overflowing ingestion",
            definition=definition,
        )

    assert validation_results[0].valid is False
    assert validation_results[0].issues[0].severity == "error"
    assert validation_results[0].issues[0].field == "chunk_size"


def test_update_pipeline_rejects_embedding_limit_overflow(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()
    overflowing_definition = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID,
        embedding_model="test/embedding-model",
        chunk_size=1024,
    )
    validating_service = PipelineService(
        session,
        embedding_input_limit=lambda _connection_id, _model: 512,
    )

    validation_results = []
    original_validate_definition = validating_service.validate_definition

    def capture_validation(*args: object, **kwargs: object):
        result = original_validate_definition(*args, **kwargs)
        validation_results.append(result)
        return result

    monkeypatch.setattr(validating_service, "validate_definition", capture_validation)
    with pytest.raises(InvalidInputError):
        validating_service.update_pipeline(
            pipeline=defaults.ingestion,
            definition=overflowing_definition,
            actor_id=user.id,
        )

    assert validation_results[0].valid is False
    assert validation_results[0].issues[0].severity == "error"
    assert defaults.ingestion.current_version == 1
    versions = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == defaults.ingestion.id
        )
    ).all()
    assert len(versions) == 1


def test_create_pipeline_remains_available_when_model_catalog_is_unreachable(
    session: Session,
) -> None:
    """A provider outage cannot make offline pipeline management unavailable."""
    user = _create_user(session)
    def unavailable_limit(_connection_id: UUID, _model: str) -> None:
        request = httpx.Request("GET", "https://openrouter.ai/api/v1/embeddings/models")
        raise httpx.ConnectError("provider unavailable", request=request)

    pipeline = PipelineService(
        session, embedding_input_limit=unavailable_limit
    ).create_pipeline(
        user=user,
        name="Offline-safe pipeline",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=EMBED_CONNECTION_ID,
            embedding_model="test-embed",
        ),
    )

    assert pipeline.name == "Offline-safe pipeline"


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
        definition=_revised_ingestion_definition(),
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

    with pytest.raises(NotFoundError, match="does not exist"):
        service.activate_version(defaults.ingestion, version=999)


def test_pipeline_in_use_detects_collection_reference(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=user,
        name="Ingestion",
        definition=build_default_ingestion_pipeline(
                embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
            ),
    )
    session.commit()
    _create_collection(session, user, ingestion_pipeline_id=pipeline.id)

    assert service.pipeline_in_use(pipeline.id)


def test_get_current_version_raises_when_missing(session: Session) -> None:
    user = _create_user(session)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Pipeline",
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
        definition=build_default_ingestion_pipeline(
                embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
            ),
    )
    service.update_pipeline(
        pipeline=pipeline,
        definition=_revised_ingestion_definition(),
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


def test_ensure_collection_bindings_sets_defaults(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()
    collection = _create_collection(session, user)

    service.ensure_collection_bindings(collection, defaults)
    session.commit()

    bound = _binding_pipeline_ids(session, collection)
    assert bound == {"ingest": defaults.ingestion.id, "tool": defaults.retrieval.id}


def test_backfill_default_pipelines_assigns_for_existing_collection(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    from app.services.pipelines import backfill_default_pipelines

    backfill_default_pipelines(session)
    session.commit()

    bound = _binding_pipeline_ids(session, collection)
    assert set(bound) == {"ingest", "tool"}


class TestDefaultBackendRotation:
    """Stale per-user defaults follow the deployment's configured backend.

    Regression: users whose defaults were scaffolded while Pinecone was the
    default kept attaching Pinecone pipelines to every NEW collection after
    the deployment default moved to pgvector — uploads/search then failed
    with 'Pinecone API key is not configured' despite pgvector being the
    default. Existing collections keep their (demoted) old pipeline.
    """

    @pytest.fixture(autouse=True)
    def _invalidate_cache(self):
        from app.services.app_config import invalidate_app_config_cache

        invalidate_app_config_cache()
        yield
        invalidate_app_config_cache()

    @staticmethod
    def _set_backend(session: Session, backend: str) -> None:
        from app.db.repositories import AppSettingRepository
        from app.services.app_config import invalidate_app_config_cache

        AppSettingRepository(session).upsert("indexing.default_backend", backend, updated_by=None)
        session.commit()
        invalidate_app_config_cache()

    def _node_backends(self, service: PipelineService, pipeline: models.Pipeline) -> set[str]:
        version = service.get_current_version(pipeline)
        return {
            str(node["config"].get("backend"))
            for node in version.definition["nodes"]
            if node["type"] in {"indexer.vector", "retriever.vector"}
        }

    def test_stale_defaults_rotate_to_configured_backend(self, session: Session) -> None:
        user = _create_user(session)
        service = PipelineService(session)

        self._set_backend(session, "pinecone")
        old = service.ensure_default_pipelines(user)
        session.commit()
        collection = _create_collection(
            session,
            user,
            ingestion_pipeline_id=old.ingestion.id,
            retrieval_pipeline_id=old.retrieval.id,
        )
        assert self._node_backends(service, old.ingestion) == {"pinecone"}

        self._set_backend(session, "pgvector")
        new = service.ensure_default_pipelines(user)
        session.commit()

        assert new.ingestion.id != old.ingestion.id
        assert new.retrieval.id != old.retrieval.id
        assert self._node_backends(service, new.ingestion) == {"pgvector"}
        assert self._node_backends(service, new.retrieval) == {"pgvector"}

        # The old defaults survive, demoted, and existing collections keep them.
        session.refresh(old.ingestion)
        session.refresh(old.retrieval)
        assert old.ingestion.template_slug is None
        assert old.retrieval.template_slug is None
        bound = _binding_pipeline_ids(session, collection)
        assert bound == {"ingest": old.ingestion.id, "tool": old.retrieval.id}

    def test_matching_defaults_are_left_alone(self, session: Session) -> None:
        user = _create_user(session)
        service = PipelineService(session)

        first = service.ensure_default_pipelines(user)
        session.commit()
        second = service.ensure_default_pipelines(user)

        assert second.ingestion.id == first.ingestion.id
        assert second.retrieval.id == first.retrieval.id


def test_update_pipeline_rejects_definition_with_no_changes(session: Session) -> None:
    """Regression: saving an unchanged definition used to mint an empty revision."""
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipeline = defaults.ingestion
    with pytest.raises(InvalidInputError, match="No changes to save"):
        service.update_pipeline(
            pipeline=pipeline,
            definition=service.get_definition(pipeline),
            actor_id=user.id,
        )

    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()
    assert len(versions) == 1


def test_update_pipeline_layout_only_updates_current_version_in_place(
    session: Session,
) -> None:
    """Dragging nodes persists positions without minting a new revision."""
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipeline = defaults.ingestion
    moved = service.get_definition(pipeline)
    moved.nodes[0].position = PipelineNodePosition(x=42.0, y=77.0)
    service.update_pipeline(pipeline=pipeline, definition=moved, actor_id=user.id)
    session.commit()

    refreshed = session.get(models.Pipeline, pipeline.id)
    assert refreshed is not None
    assert refreshed.current_version == 1
    stored = service.get_definition(refreshed)
    assert stored.nodes[0].position is not None
    assert stored.nodes[0].position.x == 42.0


def test_list_versions_with_changes_describes_each_revision(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    defaults = service.ensure_default_pipelines(user)
    session.commit()

    pipeline = defaults.ingestion
    service.update_pipeline(
        pipeline=pipeline,
        definition=_revised_ingestion_definition(),
        change_summary="Shrink chunks",
        actor_id=user.id,
    )
    session.commit()

    listed = service.list_versions_with_changes(pipeline)
    assert [version.version for version, _ in listed] == [2, 1]
    v2_changes = listed[0][1]
    assert any("chunk_size" in change.summary for change in v2_changes)
    v1_changes = listed[1][1]
    assert [change.kind for change in v1_changes] == ["created"]
