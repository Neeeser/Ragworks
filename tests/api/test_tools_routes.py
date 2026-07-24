"""HTTP contract for the collection tools endpoints.

Binding rules themselves are covered at the service layer
(`tests/services/test_collection_tools.py`); these pin the wire contract:
the projection shape chat/MCP consume, binding management status codes, and
argument validation on invoke.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import models
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.services.pipelines import PipelineService
from tests.utils.providers import TEST_EMBED_CONNECTION_ID


def _create_collection(client: TestClient) -> str:
    response = client.post("/api/collections", json={"name": "Tools API", "description": ""})
    assert response.status_code in (200, 201)
    return str(response.json()["id"])


def _create_pipeline(
    session: Session, user: models.User, *, callable_shape: bool, name: str
) -> models.Pipeline:
    build = build_default_retrieval_pipeline if callable_shape else build_default_ingestion_pipeline
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name=name,
        definition=build(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()
    return pipeline


def test_tools_listing_serves_the_llm_projection(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)

    response = client.get(f"/api/collections/{collection_id}/tools")

    assert response.status_code == 200
    body = response.json()
    assert body["ingest_pipeline_id"] is not None
    assert len(body["tools"]) == 1
    tool = body["tools"][0]
    assert tool["name"] == "search_tools_api"
    assert tool["base_name"] == "search"
    assert tool["output_kind"] == "chunks"
    assert tool["is_primary"] is True
    assert tool["enabled"] is True
    assert tool["parameters"]["properties"]["query"]["type"] == "string"


def test_adding_a_non_callable_pipeline_as_tool_is_rejected(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection_id = _create_collection(client)
    ingestion_only = _create_pipeline(
        session, auth_user, callable_shape=False, name="Ingest Only"
    )

    response = client.post(
        f"/api/collections/{collection_id}/tools",
        json={"pipeline_id": str(ingestion_only.id)},
    )

    assert response.status_code == 400


def test_tool_binding_management_roundtrip(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection_id = _create_collection(client)
    second = _create_pipeline(session, auth_user, callable_shape=True, name="Second Search")

    created = client.post(
        f"/api/collections/{collection_id}/tools",
        json={"pipeline_id": str(second.id)},
    )
    assert created.status_code == 201
    binding = created.json()
    assert binding["is_primary"] is False

    promoted = client.patch(
        f"/api/collections/{collection_id}/tools/{binding['id']}",
        json={"is_primary": True},
    )
    assert promoted.status_code == 200
    assert promoted.json()["is_primary"] is True

    listing = client.get(f"/api/collections/{collection_id}/tools").json()
    primaries = [tool for tool in listing["tools"] if tool["is_primary"]]
    assert [tool["id"] for tool in primaries] == [binding["id"]]

    disabled = client.patch(
        f"/api/collections/{collection_id}/tools/{binding['id']}",
        json={"enabled": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False

    # A primary binding can't be removed while others exist? It can — removal
    # promotes the next tool; the wire contract is a bare 204.
    removed = client.delete(f"/api/collections/{collection_id}/tools/{binding['id']}")
    assert removed.status_code == 204
    remaining = client.get(f"/api/collections/{collection_id}/tools").json()["tools"]
    assert len(remaining) == 1
    assert remaining[0]["is_primary"] is True


def test_invoke_validates_arguments_against_the_declaration(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)
    listing = client.get(f"/api/collections/{collection_id}/tools").json()
    binding_id = listing["tools"][0]["id"]

    response = client.post(
        f"/api/collections/{collection_id}/tools/{binding_id}/invoke",
        json={"query": "hello", "arguments": {"made_up": 1}},
    )

    assert response.status_code == 400
    assert "Unknown argument" in response.json()["detail"]


def test_invoke_rejects_a_foreign_binding_id(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)

    response = client.post(
        f"/api/collections/{collection_id}/tools/{uuid4()}/invoke",
        json={"query": "hello"},
    )

    assert response.status_code == 400


def test_tools_listing_requires_auth(unauthed_client: TestClient) -> None:
    response = unauthed_client.get(f"/api/collections/{uuid4()}/tools")
    assert response.status_code == 401


def test_tools_listing_is_owner_scoped(
    client: TestClient, session: Session
) -> None:
    other = models.User(email="other@example.com", full_name="Other", hashed_password="x")
    session.add(other)
    session.commit()
    session.refresh(other)
    foreign = models.Collection(
        user_id=other.id, name="Foreign", description="", extra_metadata={}
    )
    session.add(foreign)
    session.commit()

    response = client.get(f"/api/collections/{foreign.id}/tools")

    assert response.status_code == 404


def test_search_slug_survives_for_default_pipelines(
    client: TestClient, session: Session
) -> None:
    """The pre-tools `search_<collection>` naming contract is unchanged for
    migrated/default pipelines whose input node declares no tool identity."""
    response = client.post(
        "/api/collections", json={"name": "Quarterly Reports", "description": ""}
    )
    collection_id = response.json()["id"]
    default_search = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.template_slug == "default-search",
        )
    ).first()
    assert default_search is not None

    listing = client.get(f"/api/collections/{collection_id}/tools").json()

    assert listing["tools"][0]["name"] == "search_quarterly_reports"


def test_updating_an_unknown_binding_is_not_found(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)

    response = client.patch(
        f"/api/collections/{collection_id}/tools/{uuid4()}",
        json={"enabled": False},
    )

    assert response.status_code == 404


def test_removing_an_unknown_binding_is_not_found(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)

    response = client.delete(f"/api/collections/{collection_id}/tools/{uuid4()}")

    assert response.status_code == 404


def test_binding_the_same_pipeline_twice_is_rejected(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection_id = _create_collection(client)
    listing = client.get(f"/api/collections/{collection_id}/tools").json()
    already_bound = listing["tools"][0]["pipeline_id"]

    response = client.post(
        f"/api/collections/{collection_id}/tools",
        json={"pipeline_id": already_bound},
    )

    assert response.status_code == 400
    assert "already bound" in response.json()["detail"]


def test_invoke_failure_returns_structured_trace_linked_detail(
    client: TestClient, session: Session, monkeypatch
) -> None:
    """A failed tool run returns the structured, trace-linked error body —
    the same contract the legacy query endpoint carries."""

    class _FailingEmbedder:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

        @property
        def usage(self) -> dict[str, int] | None:
            return None

        def embed_query(self, _query: str) -> list[float]:
            raise RuntimeError("embed boom")

        def embed_documents(self, chunks: object) -> list[list[float]]:
            return [[0.1, 0.2, 0.3] for _ in chunks]  # type: ignore[attr-defined]

    class _FailingResolver:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def embedder(self, _connection_id: object, model_name: str, dimensions: object = None):
            del dimensions
            return _FailingEmbedder(model_name)

    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _FailingResolver)
    collection_id = _create_collection(client)
    binding_id = client.get(f"/api/collections/{collection_id}/tools").json()["tools"][0]["id"]

    response = client.post(
        f"/api/collections/{collection_id}/tools/{binding_id}/invoke",
        json={"query": "hi"},
    )

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail["code"] == "retrieval_pipeline_failed"
    assert detail["pipeline_run_id"]
