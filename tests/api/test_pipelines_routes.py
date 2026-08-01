from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes import pipelines as pipelines_routes
from app.db import models
from app.db.repositories import UserRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.services.pipelines import PipelineService
from tests.utils.providers import TEST_EMBED_CONNECTION_ID


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
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
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


def test_get_pipeline_or_404_returns_owned_pipeline(session: Session) -> None:
    """The shared dependency every pipeline-id route now depends on.

    `get_pipeline`, `update_pipeline`, `list_pipeline_versions`,
    `activate_pipeline_version`, and `delete_pipeline` all resolve their
    pipeline through `Depends(get_pipeline_or_404)` instead of repeating a
    get-or-404 check -- the route-level tests below pass an already-resolved
    `pipeline` straight in, so this is the one place both of the dependency's
    own branches (found vs. missing) are exercised.
    """
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    result = pipelines_routes.get_pipeline_or_404(pipeline.id, current_user=user, session=session)

    assert result.id == pipeline.id


def test_get_pipeline_or_404_rejects_missing_pipeline(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        pipelines_routes.get_pipeline_or_404(uuid4(), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_delete_pipeline_blocks_in_use(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)
    _create_collection(session, user, ingestion_pipeline_id=pipeline.id)

    with pytest.raises(HTTPException) as excinfo:
        pipelines_routes.delete_pipeline(pipeline=pipeline, session=session)

    assert excinfo.value.status_code == 409


def test_delete_pipeline_removes_versions(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    response = pipelines_routes.delete_pipeline(pipeline=pipeline, session=session)

    assert response.status == "deleted"
    assert session.get(models.Pipeline, pipeline.id) is None
    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()
    assert len(versions) == 0


def test_list_pipeline_nodes_returns_specs() -> None:
    response = pipelines_routes.list_pipeline_nodes(_current_user=models.User())

    assert response.nodes


def test_node_specs_carry_port_facets_and_presets() -> None:
    """The wire keeps facet declarations and presets — the editor's facet
    mirror and preset library render from exactly these fields."""
    response = pipelines_routes.list_pipeline_nodes(_current_user=models.User())
    by_type = {spec.type: spec for spec in response.nodes}

    reranker = by_type["llm.rerank"]
    assert reranker.input_ports[0].requires == ("text",)
    assert reranker.output_ports[0].adds == ("score",)
    assert reranker.output_ports[0].preserves is True
    assert any(preset.id == "llm-judge" for preset in reranker.presets)

    transform = by_type["llm.transform"]
    preset_ids = {preset.id for preset in transform.presets}
    assert "contextual-retrieval" in preset_ids
    contextual = next(p for p in transform.presets if p.id == "contextual-retrieval")
    assert "{document_text}" in str(contextual.config["prompt"])


def test_validate_pipeline_returns_success(session: Session) -> None:
    definition = build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        )

    response = pipelines_routes.validate_pipeline(
        definition,
        current_user=models.User(),
        session=session,
    )

    assert response.valid is True
    assert response.errors == []
    assert any("does not publish an input token limit" in warning for warning in response.warnings)


def test_validate_pipeline_requires_index_name(session: Session) -> None:
    definition = build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        )
    for node in definition.nodes:
        if node.type.startswith("indexer."):
            node.config = {**(node.config or {}), "index_name": ""}
    response = pipelines_routes.validate_pipeline(
        definition,
        current_user=models.User(),
        session=session,
    )

    assert response.valid is False
    assert any("must specify an index" in error for error in response.errors)


def test_validate_pipeline_returns_warnings(session: Session) -> None:
    definition = build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        )
    for node in definition.nodes:
        if node.type == "embedder.text":
            node.config = {**(node.config or {}), "dimension": 512}
    response = pipelines_routes.validate_pipeline(
        definition,
        current_user=models.User(),
        session=session,
    )

    assert response.warnings != []
    assert any("no dimension configured" in warning for warning in response.warnings)


def test_list_pipelines_returns_results(session: Session) -> None:
    user = _create_user(session)
    _create_pipeline(session, user)

    results = pipelines_routes.list_pipelines(current_user=user, session=session)

    assert results


def test_list_pipelines_filters_by_kind(session: Session) -> None:
    user = _create_user(session)
    service = PipelineService(session)
    service.create_pipeline(
        user=user,
        name="Ingestion",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    service.create_pipeline(
        user=user,
        name="Retrieval",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()

    results = pipelines_routes.list_pipelines(
        kind=models.PipelineKind.RETRIEVAL,
        current_user=user,
        session=session,
    )

    assert results
    assert all(item.kind == models.PipelineKind.RETRIEVAL for item in results)


def test_get_pipeline_returns_pipeline(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    result = pipelines_routes.get_pipeline(pipeline=pipeline, session=session)

    assert result.id == pipeline.id


def test_update_pipeline_updates_name(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    updated = pipelines_routes.update_pipeline(
        pipelines_routes.PipelineUpdate(name="Updated"),
        pipeline=pipeline,
        current_user=user,
        session=session,
    )

    assert updated.name == "Updated"


def test_update_pipeline_updates_definition(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)
    previous_version = pipeline.current_version

    definition = build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        )
    chunker = next(node for node in definition.nodes if node.id == "chunk-document")
    chunker.config = {**chunker.config, "chunk_size": 256}
    updated = pipelines_routes.update_pipeline(
        pipelines_routes.PipelineUpdate(
            name="Updated",
            description="Updated description",
            definition=definition,
            change_summary="Updated pipeline",
        ),
        pipeline=pipeline,
        current_user=user,
        session=session,
    )

    assert updated.current_version == previous_version + 1


def test_update_pipeline_rejects_no_change_save(session: Session) -> None:
    """Regression: an unchanged definition used to mint an empty revision; now 400."""
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    with pytest.raises(HTTPException) as excinfo:
        pipelines_routes.update_pipeline(
            pipelines_routes.PipelineUpdate(definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        )),
            pipeline=pipeline,
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 400


def test_list_pipeline_versions_returns_entries(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    versions = pipelines_routes.list_pipeline_versions(pipeline=pipeline, session=session)

    assert versions


def test_activate_pipeline_version_updates_current(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    response = pipelines_routes.activate_pipeline_version(
        pipelines_routes.PipelineActivateRequest(version=pipeline.current_version),
        pipeline=pipeline,
        current_user=user,
        session=session,
    )

    assert response.id == pipeline.id


def test_activate_pipeline_version_unknown_version(session: Session) -> None:
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)

    with pytest.raises(HTTPException) as excinfo:
        pipelines_routes.activate_pipeline_version(
            pipelines_routes.PipelineActivateRequest(version=999),
            pipeline=pipeline,
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 404


def test_create_pipeline_creates_record(session: Session) -> None:
    user = _create_user(session)

    created = pipelines_routes.create_pipeline(
        pipelines_routes.PipelineCreate(
            name="New Pipeline",
            definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
        ),
        current_user=user,
        session=session,
    )

    assert created.name == "New Pipeline"
    assert created.validation_issues
    assert created.validation_issues[0].severity == "warning"


def test_copy_pipeline_duplicates_the_graph_under_a_new_name(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """Copying is how one graph becomes two that differ.

    A pipeline names the index it uses, so serving another collection from
    another store means another pipeline; the copy has to carry the graph or
    the user is rebuilding it by hand.
    """
    pipeline = _create_pipeline(session, auth_user)
    original = PipelineService(session).get_definition(pipeline)

    response = client.post(f"/api/pipelines/{pipeline.id}/copy", json={})

    assert response.status_code == 201
    body = response.json()
    assert body["id"] != str(pipeline.id)
    assert body["name"] == f"{pipeline.name} (copy)"
    with Session(session.get_bind()) as fresh:
        copy = fresh.get(models.Pipeline, UUID(body["id"]))
        assert copy is not None
        # A copy claims no default role: two pipelines holding one template
        # slug would make "the default ingestion pipeline" ambiguous.
        assert copy.template_slug is None
        assert PipelineService(fresh).get_definition(copy) == original


def test_copy_pipeline_accepts_an_explicit_name(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    pipeline = _create_pipeline(session, auth_user)

    response = client.post(
        f"/api/pipelines/{pipeline.id}/copy", json={"name": "Facts ingestion"}
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Facts ingestion"


def test_copying_a_pipeline_that_no_longer_validates_is_a_400(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """A stored definition can stop validating; the copy must say so.

    Copying re-validates, so a graph that was saved when it was valid and is
    not any more (a node type retired, an edge left dangling by a migration)
    reaches the create path and is refused. Untranslated, that domain error
    surfaces as a 500 and the user has nothing to act on.
    """
    pipeline = _create_pipeline(session, auth_user)
    version = PipelineService(session).get_current_version(pipeline)
    stored = dict(version.definition)
    # A dangling edge: valid Pydantic, invalid graph.
    stored["edges"] = [
        *stored["edges"],
        {
            "id": "dangling",
            "source": "nowhere",
            "target": "nothing",
            "source_port": "documents",
            "target_port": "documents",
        },
    ]
    version.definition = stored
    session.add(version)
    session.commit()

    response = client.post(f"/api/pipelines/{pipeline.id}/copy", json={})

    assert response.status_code == 400
    assert "errors" in response.json()["detail"]
