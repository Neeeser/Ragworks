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
from app.pipelines.resolution import resolve_static_definition
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipelines import (
    DEFAULT_INGEST_SLUG,
    DEFAULT_SEARCH_SLUG,
    PipelineService,
)
from tests.utils.pipelines import with_tool_name
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
        name="Default Search Tool",
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


def test_create_pipeline_warns_but_saves_an_oversized_chunk_window(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An oversized window still ingests, so it must not block the save.

    The embedding guard splits the chunk and the file row carries a warning
    badge, so refusing the save would strand work over a recoverable condition.
    """
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
    created = service.create_pipeline(
        user=user,
        name="Overflowing ingestion",
        definition=definition,
    )

    assert created is not None
    assert validation_results[0].valid is True
    issue = next(
        item
        for item in validation_results[0].issues
        if item.code == "embedding_input_limit_exceeded"
    )
    assert issue.severity == "warning"
    assert issue.field == "chunk_size"


def test_update_pipeline_warns_but_saves_an_oversized_chunk_window(
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
    validating_service.update_pipeline(
        pipeline=defaults.ingestion,
        definition=overflowing_definition,
        actor_id=user.id,
    )

    assert validation_results[0].valid is True
    issue = next(
        item
        for item in validation_results[0].issues
        if item.code == "embedding_input_limit_exceeded"
    )
    assert issue.severity == "warning"
    # The advisory finding must not stop the new version being written.
    assert defaults.ingestion.current_version == 2
    versions = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == defaults.ingestion.id
        )
    ).all()
    assert len(versions) == 2


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


def _bind_tool(
    session: Session, collection: models.Collection, pipeline_id: UUID
) -> models.CollectionPipelineBinding:
    """Bind a pipeline as a tool directly (bypassing `CollectionToolService`).

    Used to build a collection whose tool bindings already exist -- some
    tests need siblings the pipeline-save collision check compares against;
    others need a *pre-existing* collision `CollectionToolService.add_tool`
    could never have created, to prove an unrelated save still works.
    """
    binding = models.CollectionPipelineBinding(
        collection_id=collection.id,
        pipeline_id=pipeline_id,
        role=models.BindingRole.TOOL,
    )
    session.add(binding)
    session.commit()
    session.refresh(binding)
    return binding


class TestUpdatePipelineToolNameCollisions:
    """Editing a bound pipeline's tool_name onto a sibling binding's name."""

    def test_rejects_a_rename_onto_a_sibling_bindings_name(self, session: Session) -> None:
        user = _create_user(session)
        service = PipelineService(session)
        alpha = service.create_pipeline(
            user=user,
            name="Alpha",
            definition=with_tool_name(
                build_default_retrieval_pipeline(
                    embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
                ),
                "alpha",
            ),
        )
        beta = service.create_pipeline(
            user=user,
            name="Beta",
            definition=with_tool_name(
                build_default_retrieval_pipeline(
                    embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
                ),
                "beta",
            ),
        )
        session.commit()
        collection = _create_collection(session, user)
        _bind_tool(session, collection, alpha.id)
        _bind_tool(session, collection, beta.id)

        renamed = with_tool_name(service.get_definition(alpha), "beta")

        with pytest.raises(InvalidInputError) as exc_info:
            service.update_pipeline(pipeline=alpha, definition=renamed, actor_id=user.id)

        message = str(exc_info.value)
        assert "Alpha" in message
        assert "Beta" in message
        assert "beta" in message

    def test_allows_an_unrelated_edit_despite_a_pre_existing_collision(
        self, session: Session
    ) -> None:
        """A collection may already hold two same-named tool bindings (legacy
        data from before this check existed -- see `DuplicateToolNameRule`).
        That must not lock either pipeline out of an edit that leaves the
        name alone."""
        user = _create_user(session)
        service = PipelineService(session)
        first = service.create_pipeline(
            user=user,
            name="First",
            definition=build_default_retrieval_pipeline(
                embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
            ),
        )
        second = service.create_pipeline(
            user=user,
            name="Second",
            definition=build_default_retrieval_pipeline(
                embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
            ),
        )
        session.commit()
        collection = _create_collection(session, user)
        _bind_tool(session, collection, first.id)
        _bind_tool(session, collection, second.id)

        unrelated = PipelineDefinition.model_validate(service.get_definition(first).model_dump())
        embedder = next(node for node in unrelated.nodes if node.type == "embedder.text")
        embedder.config = {**embedder.config, "model_name": "a-different-embed-model"}

        updated = service.update_pipeline(pipeline=first, definition=unrelated, actor_id=user.id)

        assert updated.current_version == 2


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
    def _isolate_backend_setting(self, session: Session):
        """Invalidate the config cache and drop the override afterwards.

        The override is a real row, so leaving it behind changes what every
        later test reads from `get_app_config()` — including the committed
        README fixture's expected default backend, which then fails only when
        the test order puts this class first.
        """
        from app.db.repositories import AppSettingRepository
        from app.services.app_config import invalidate_app_config_cache

        invalidate_app_config_cache()
        yield
        AppSettingRepository(session).delete("indexing.default_backend")
        session.commit()
        invalidate_app_config_cache()

    @staticmethod
    def _set_backend(session: Session, backend: str) -> None:
        from app.db.repositories import AppSettingRepository
        from app.services.app_config import invalidate_app_config_cache

        AppSettingRepository(session).upsert("indexing.default_backend", backend, updated_by=None)
        session.commit()
        invalidate_app_config_cache()

    def _node_backends(self, service: PipelineService, pipeline: models.Pipeline) -> set[str]:
        """Backends the pipeline's store-bound nodes resolve to.

        Read through resolution, not the raw config: identity fields hold
        expressions over the pipeline's index variable, so the stored dict
        says `{"$expr": ...}` while the pipeline still targets one backend.
        """
        version = service.get_current_version(pipeline)
        definition = resolve_static_definition(
            PipelineDefinition.model_validate(version.definition)
        )
        return {
            str(node.config.get("backend"))
            for node in definition.nodes
            if node.type in {"indexer.vector", "retriever.vector"}
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


def test_kind_filtered_listing_keeps_shapeless_pipelines_visible(session: Session) -> None:
    """A graph that is neither document-accepting nor callable (e.g. a blank
    or mid-edit pipeline) appears under every kind filter — otherwise it
    would be unreachable from the kind-paged editor."""
    from app.pipelines.definition import PipelineDefinition

    user = _create_user(session)
    service = PipelineService(session)
    shapeless = service.create_pipeline(
        user=user,
        name="Work in progress",
        definition=PipelineDefinition(nodes=[], edges=[]),
    )
    session.commit()

    ingestion_ids = {p.id for p in service.list_pipelines(user.id, kind=models.PipelineKind.INGESTION)}
    retrieval_ids = {p.id for p in service.list_pipelines(user.id, kind=models.PipelineKind.RETRIEVAL)}

    assert shapeless.id in ingestion_ids
    assert shapeless.id in retrieval_ids


def test_a_default_pipeline_is_checked_against_the_index_it_names(session: Session) -> None:
    """The shape the setup wizard scaffolds, validated through the service.

    Neither node states a width: the embedder leaves `dimension` unset (most
    models reject an explicit request) and the indexer names a registered
    index instead of restating its shape. Switching the model to a narrower
    one must fail the save here rather than every document at ingest.
    """
    from app.schemas.enums import IndexBackend
    from app.services.index_registry import IndexRegistryService

    user = _create_user(session)
    IndexRegistryService(session).register(
        user, IndexBackend.PGVECTOR, "ragworks", dimension=1536
    )
    definition = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID,
        embedding_model="baai/bge-base-en-v1.5",
        index_name="ragworks",
    )
    # Only the provider is stubbed; the index width is read from the registry
    # the way the running app reads it.
    service = PipelineService(session, embedding_dimension=lambda _connection, _model: 768)

    result = service.validate_definition(user, definition)

    assert result.valid is False
    mismatch = [
        issue for issue in result.issues if issue.code == "embedder_index_dimension_mismatch"
    ]
    assert len(mismatch) == 1
    assert mismatch[0].node_id == "index-chunks"
    assert "ragworks" in mismatch[0].message
    assert "1536" in mismatch[0].message
    assert "768" in mismatch[0].message


def test_a_default_pipeline_matching_its_index_validates(session: Session) -> None:
    user = _create_user(session)
    from app.schemas.enums import IndexBackend
    from app.services.index_registry import IndexRegistryService

    IndexRegistryService(session).register(
        user, IndexBackend.PGVECTOR, "ragworks", dimension=768
    )
    definition = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID,
        embedding_model="baai/bge-base-en-v1.5",
        index_name="ragworks",
    )
    service = PipelineService(session, embedding_dimension=lambda _connection, _model: 768)

    result = service.validate_definition(user, definition)

    assert [issue for issue in result.issues if issue.code.startswith("embedder_index")] == []
