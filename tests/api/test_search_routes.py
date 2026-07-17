"""HTTP contract for the search routes' argument surface.

Query behavior itself is covered at the service layer
(`tests/services/test_retrieval.py`); these tests pin the wire contract of
the new `query-arguments` endpoint and the `arguments` request field.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.services.pipelines import PipelineService


def _create_collection(client: TestClient) -> str:
    response = client.post("/api/collections", json={"name": "Search API", "description": ""})
    assert response.status_code in (200, 201)
    return str(response.json()["id"])


def _declare_top_k_argument(session: Session, user: models.User) -> None:
    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.kind == models.PipelineKind.RETRIEVAL,
        )
    ).one()
    service = PipelineService(session)
    definition = PipelineDefinition.model_validate(
        service.get_current_version(pipeline).definition
    )
    for node in definition.nodes:
        if node.type == "retrieval.input":
            node.config = {
                **node.config,
                "arguments": [
                    {
                        "name": "top_k",
                        "type": "integer",
                        "default": 5,
                        "minimum": 1,
                        "maximum": 10,
                        "expose_to_llm": True,
                    }
                ],
            }
    service.update_pipeline(
        pipeline=pipeline, definition=definition, change_summary="Declare top_k."
    )
    session.commit()


def test_query_arguments_empty_for_legacy_pipeline(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)
    response = client.get(f"/api/collections/{collection_id}/query-arguments")
    assert response.status_code == 200
    assert response.json() == {"arguments": []}


def test_query_arguments_returns_declared_shape(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection_id = _create_collection(client)
    _declare_top_k_argument(session, auth_user)
    response = client.get(f"/api/collections/{collection_id}/query-arguments")
    assert response.status_code == 200
    arguments = response.json()["arguments"]
    assert arguments == [
        {
            "name": "top_k",
            "type": "integer",
            "description": "",
            "required": False,
            "default": 5,
            "minimum": 1.0,
            "maximum": 10.0,
            "choices": [],
            "expose_to_llm": True,
        }
    ]


def test_query_arguments_requires_auth(unauthed_client: TestClient) -> None:
    response = unauthed_client.get(
        "/api/collections/00000000-0000-0000-0000-000000000000/query-arguments"
    )
    assert response.status_code == 401


def test_query_rejects_invalid_argument_value_with_400(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection_id = _create_collection(client)
    _declare_top_k_argument(session, auth_user)
    response = client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "hello", "arguments": {"top_k": 99}},
    )
    assert response.status_code == 400
    assert "must be at most 10" in response.json()["detail"]


def test_query_rejects_unknown_argument_with_400(
    client: TestClient, session: Session
) -> None:
    collection_id = _create_collection(client)
    response = client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "hello", "arguments": {"nope": 1}},
    )
    assert response.status_code == 400
    assert "Unknown argument" in response.json()["detail"]
