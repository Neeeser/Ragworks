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


def _persist_user(session: Session) -> models.User:
    """A committed user with shipped prompts seeded (preset refs need them)."""
    from app.services.prompts.seeding import seed_shipped_prompts

    user = _create_user(session)
    seed_shipped_prompts(session, user.id)
    session.commit()
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


def test_list_pipeline_nodes_returns_specs(session: Session) -> None:
    response = pipelines_routes.list_pipeline_nodes(
        current_user=_persist_user(session), session=session
    )

    assert response.nodes


def test_node_specs_carry_port_facets_and_presets(session: Session) -> None:
    """The wire keeps facet declarations and presets — the editor's facet
    mirror and preset library render from exactly these fields."""
    response = pipelines_routes.list_pipeline_nodes(
        current_user=_persist_user(session), session=session
    )
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
    # Seeded users get library references; the shipped body itself lives on
    # the referenced prompt, not inline in the preset config.
    assert "prompt_ref" in contextual.config


def test_node_specs_carry_every_field_the_editor_infers_from(session: Session) -> None:
    """The editor mirrors the server's inference, so it needs the same inputs.

    `accepts`/`unaccepted` decide whether a node's `adds` and `removes`
    reach the whole stream: a port serialized without them looks
    unrestricted, and the editor then computes guarantees the server does
    not agree with on every graph holding a restricted node.
    """
    response = pipelines_routes.list_pipeline_nodes(
        current_user=_persist_user(session), session=session
    )
    by_type = {spec.type: spec for spec in response.nodes}

    chunker = by_type["chunker.token"]
    assert chunker.input_ports[0].accepts == ("text",)
    assert chunker.input_ports[0].unaccepted == "passthrough"
    assert chunker.output_ports[0].removes == ("embedding", "score")

    indexer = by_type["indexer.vector"]
    assert indexer.input_ports[0].accepts == ("embedding",)
    assert indexer.input_ports[0].unaccepted == "exclude"


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


def test_tool_template_catalog_is_the_wizard_menu(client: TestClient) -> None:
    """The wizard renders from this catalog, so it carries what each step needs."""
    response = client.get("/api/pipelines/tool-templates")

    assert response.status_code == 200
    templates = {entry["id"]: entry for entry in response.json()["templates"]}
    assert set(templates) == {"semantic-keyword", "reranked", "count", "facet", "blank"}
    assert templates["reranked"]["needs_reranker"] is True
    assert templates["blank"]["needs_store"] is False
    # Aggregates run only where the backend can answer lexical queries.
    assert templates["count"]["supported_backends"] == ["pgvector"]


def test_scaffold_tool_template_builds_the_shipped_graph(client: TestClient) -> None:
    """The wizard creates the server's graph, not one it assembled itself."""
    response = client.post(
        "/api/pipelines/tool-templates/reranked",
        json={
            "backend": "pgvector",
            "index_name": "docs",
            "embedding_connection_id": str(TEST_EMBED_CONNECTION_ID),
            "embedding_model": "text-embedding-3-small",
            "reranking_connection_id": str(TEST_EMBED_CONNECTION_ID),
            "reranking_model": "rerank-v3.5",
        },
    )

    assert response.status_code == 200
    definition = response.json()
    reranker = next(node for node in definition["nodes"] if node["type"] == "reranker.model")
    assert reranker["config"]["model_name"] == "rerank-v3.5"
    assert {edge["source_port"] for edge in definition["edges"]} == {"items"}


def test_scaffold_tool_template_rejects_missing_choices(client: TestClient) -> None:
    """A template asked to build without what it declares it needs is a 400."""
    response = client.post(
        "/api/pipelines/tool-templates/reranked",
        json={"backend": "pgvector", "index_name": "docs"},
    )

    assert response.status_code == 400


def test_scaffold_unknown_tool_template_is_rejected(client: TestClient) -> None:
    response = client.post("/api/pipelines/tool-templates/nope", json={"backend": "pgvector"})

    assert response.status_code == 400


def _auth_user_retrieval_pipeline(session: Session, user: models.User) -> models.Pipeline:
    return PipelineService(session).ensure_default_pipelines(user).retrieval


def _auth_user_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Draft run", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_draft_run_rejects_an_invalid_draft_with_its_validation_payload(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """The editor's Run gets the same issue payload its live validation reads,
    so a refused run points at what is wrong instead of failing opaquely."""
    pipeline = _auth_user_retrieval_pipeline(session, auth_user)
    collection = _auth_user_collection(session, auth_user)
    definition = PipelineService(session).get_definition(pipeline).model_dump(mode="json")
    definition["edges"].append(
        {**definition["edges"][0], "id": "broken", "target_port": "nonsense"}
    )

    response = client.post(
        f"/api/pipelines/{pipeline.id}/draft-run",
        json={
            "definition": definition,
            "collection_id": str(collection.id),
            "query": "anything",
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "pipeline_draft_invalid"
    assert detail["errors"]


def test_draft_run_rejects_a_collection_the_caller_does_not_own(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """A draft run reads a corpus, so the collection is an ownership boundary."""
    pipeline = _auth_user_retrieval_pipeline(session, auth_user)
    stranger = _create_user(session)
    theirs = _auth_user_collection(session, stranger)

    response = client.post(
        f"/api/pipelines/{pipeline.id}/draft-run",
        json={
            "definition": PipelineService(session)
            .get_definition(pipeline)
            .model_dump(mode="json"),
            "collection_id": str(theirs.id),
            "query": "anything",
        },
    )

    assert response.status_code == 404


def test_draft_run_rejects_a_pipeline_the_caller_does_not_own(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    stranger = _create_user(session)
    theirs = _create_pipeline(session, stranger)
    collection = _auth_user_collection(session, auth_user)

    response = client.post(
        f"/api/pipelines/{theirs.id}/draft-run",
        json={
            "definition": PipelineService(session).get_definition(theirs).model_dump(mode="json"),
            "collection_id": str(collection.id),
            "query": "anything",
        },
    )

    assert response.status_code == 404
