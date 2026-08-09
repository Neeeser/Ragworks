"""HTTP contract for the search routes' argument surface.

Query behavior itself is covered at the service layer
(`tests/services/test_retrieval.py`); these tests pin the wire contract of
the new `query-arguments` endpoint and the `arguments` request field.
"""

from __future__ import annotations

import base64
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import AppSettingRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.variables import PipelineVariable, VariableSource, VariableType
from app.services.app_config import invalidate_app_config_cache
from app.services.errors import InvalidInputError
from app.services.pipelines import PipelineService
from tests.utils.collections import api_collection_payload


def _create_collection(client: TestClient) -> str:
    response = client.post("/api/collections", json=api_collection_payload(client, "Search API"))
    assert response.status_code in (200, 201)
    return str(response.json()["id"])


def _declare_result_limit_argument(session: Session, user: models.User) -> None:
    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == "default-search",
        )
    ).one()
    service = PipelineService(session)
    definition = PipelineDefinition.model_validate(service.get_current_version(pipeline).definition)
    # Index variables survive: the store-bound nodes' identity fields are
    # expressions over them, so replacing the whole list would leave the graph
    # referencing variables that no longer exist.
    definition.variables = [
        *(variable for variable in definition.variables if variable.type == "index"),
        PipelineVariable(
            name="result_limit",
            type=VariableType.INTEGER,
            source=VariableSource.INPUT,
            value=5,
            minimum=1,
            maximum=10,
            expose_to_llm=True,
        )
    ]
    for node in definition.nodes:
        if node.type == "retrieval.input":
            node.config = {**node.config, "arguments": ["result_limit"]}
    service.update_pipeline(
        pipeline=pipeline,
        definition=definition,
        change_summary="Declare result_limit.",
    )
    session.commit()


def test_query_arguments_reflect_default_scaffold(client: TestClient, session: Session) -> None:
    collection_id = _create_collection(client)
    response = client.get(f"/api/collections/{collection_id}/query-arguments")
    assert response.status_code == 200
    names = [argument["name"] for argument in response.json()["arguments"]]
    assert names == ["result_limit"]


def test_query_arguments_returns_declared_shape(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection_id = _create_collection(client)
    _declare_result_limit_argument(session, auth_user)
    response = client.get(f"/api/collections/{collection_id}/query-arguments")
    assert response.status_code == 200
    arguments = response.json()["arguments"]
    assert arguments == [
        {
            "name": "result_limit",
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
    _declare_result_limit_argument(session, auth_user)
    response = client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "hello", "arguments": {"result_limit": 99}},
    )
    assert response.status_code == 400
    assert "must be at most 10" in response.json()["detail"]


def test_query_rejects_unknown_argument_with_400(client: TestClient, session: Session) -> None:
    collection_id = _create_collection(client)
    response = client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "hello", "arguments": {"nope": 1}},
    )
    assert response.status_code == 400
    assert "Unknown argument" in response.json()["detail"]


def test_query_failure_returns_structured_detail(
    client: TestClient, monkeypatch, auth_user: models.User
) -> None:
    """A failed retrieval returns the structured, trace-linked error body.

    Drives the real route with the provider boundary stubbed to fail, and
    asserts the HTTP error `detail` is the `RetrievalFailureDetail` object
    (failed node + run id), not a plain string.
    """

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
    response = client.post(f"/api/collections/{collection_id}/query", json={"query": "hi"})

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail["code"] == "retrieval_pipeline_failed"
    assert detail["failed_node"]["node_type"]
    assert detail["pipeline_run_id"]


def test_a_nodes_own_complaint_reaches_the_user_as_a_400(
    client: TestClient, monkeypatch, auth_user: models.User
) -> None:
    """A node's typed `InvalidInputError` already says what to change.

    Folding it into "internal error" (500) hides the one sentence that fixes
    the pipeline — a namespace the account does not own, a dimension the index
    disagrees with, a sparse index on a server without pg_search.
    """
    del auth_user

    class _RefusingEmbedder:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

        @property
        def usage(self) -> dict[str, int] | None:
            return None

        def embed_query(self, _query: str) -> list[float]:
            raise InvalidInputError("Namespace 'col-other' belongs to another account.")

        def embed_documents(self, chunks: object) -> list[list[float]]:
            return [[0.1, 0.2, 0.3] for _ in chunks]  # type: ignore[attr-defined]

    class _RefusingResolver:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def embedder(self, _connection_id: object, model_name: str, dimensions: object = None):
            del dimensions
            return _RefusingEmbedder(model_name)

    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _RefusingResolver)
    collection_id = _create_collection(client)

    response = client.post(f"/api/collections/{collection_id}/query", json={"query": "hi"})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "belongs to another account" in detail["message"]
    assert detail["failed_node"]["node_type"]


def _png_base64() -> str:
    data = (Path(__file__).parent.parent / "assets" / "diagram.png").read_bytes()
    return base64.b64encode(data).decode("ascii")


class TestQueryMediaContract:
    """The wire contract for an image query: what is accepted and what is not."""

    def test_a_request_with_neither_text_nor_media_is_rejected(
        self, client: TestClient
    ) -> None:
        collection_id = _create_collection(client)
        response = client.post(
            f"/api/collections/{collection_id}/query", json={"query": "   "}
        )
        assert response.status_code == 422

    def test_an_unsupported_media_type_is_rejected(self, client: TestClient) -> None:
        collection_id = _create_collection(client)
        response = client.post(
            f"/api/collections/{collection_id}/query",
            json={"query": "", "query_media": {"media_type": "image/tiff", "data": "AAAA"}},
        )
        assert response.status_code == 400
        assert "not a supported image type" in response.json()["detail"]

    def test_data_that_is_not_base64_is_rejected(self, client: TestClient) -> None:
        collection_id = _create_collection(client)
        response = client.post(
            f"/api/collections/{collection_id}/query",
            json={
                "query": "",
                "query_media": {"media_type": "image/png", "data": "not base64!!"},
            },
        )
        assert response.status_code == 400
        assert "not valid base64" in response.json()["detail"]

    def test_an_image_over_the_configured_limit_is_rejected(
        self, client: TestClient, session: Session
    ) -> None:
        collection_id = _create_collection(client)
        settings_repo = AppSettingRepository(session)
        settings_repo.upsert("uploads.max_image_upload_size_mb", 1, updated_by=None)
        session.commit()
        invalidate_app_config_cache()
        try:
            oversize = base64.b64encode(b"\x89PNG" + b"\0" * (2 * 1024 * 1024)).decode("ascii")
            response = client.post(
                f"/api/collections/{collection_id}/query",
                json={
                    "query": "",
                    "query_media": {"media_type": "image/png", "data": oversize},
                },
            )
            assert response.status_code == 400
            assert "exceeds the configured 1MB" in response.json()["detail"]
        finally:
            settings_repo.delete("uploads.max_image_upload_size_mb")
            session.commit()
            invalidate_app_config_cache()

    def test_the_tool_invoke_surface_takes_the_same_pair(self, client: TestClient) -> None:
        """The search composer posts here whenever a binding exists, so this
        endpoint refuses an empty ask exactly like the query endpoint."""
        collection_id = _create_collection(client)
        binding_id = client.get(f"/api/collections/{collection_id}/tools").json()["tools"][0][
            "id"
        ]
        response = client.post(
            f"/api/collections/{collection_id}/tools/{binding_id}/invoke", json={"query": ""}
        )
        assert response.status_code == 422

        refused = client.post(
            f"/api/collections/{collection_id}/tools/{binding_id}/invoke",
            json={"query": "", "query_media": {"media_type": "image/tiff", "data": "AAAA"}},
        )
        assert refused.status_code == 400

    def test_a_valid_image_reaches_the_pipeline_and_comes_back_as_a_reference(
        self, client: TestClient, pgvector_session: Session, monkeypatch
    ) -> None:
        """The route stores the bytes, queries with the reference, and returns
        the stored path — which the collection asset route serves."""
        del pgvector_session  # skips the test where the extension is absent

        class _MultimodalEmbedder:
            def __init__(self, model_name: str) -> None:
                self.model_name = model_name

            @property
            def usage(self) -> dict[str, int] | None:
                return None

            def embed_query(self, _query: str) -> list[float]:
                return [0.1, 0.2, 0.3]

            def embed_documents(self, chunks: object) -> list[list[float]]:
                return [[0.1, 0.2, 0.3] for _ in chunks]  # type: ignore[attr-defined]

            def embed_images(self, images: object) -> list[list[float]]:
                return [[0.1, 0.2, 0.3] for _ in images]  # type: ignore[attr-defined]

        class _MultimodalResolver:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def embedder(self, _connection_id: object, model_name: str, dimensions: object = None):
                del dimensions
                return _MultimodalEmbedder(model_name)

            def input_modalities(
                self, _connection_id: object, _model_name: str, _kind: object
            ) -> frozenset[str]:
                return frozenset({"text", "image"})

        monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _MultimodalResolver)
        collection_id = _create_collection(client)

        response = client.post(
            f"/api/collections/{collection_id}/query",
            json={"query": "", "query_media": {"media_type": "image/png", "data": _png_base64()}},
        )

        assert response.status_code == 200
        media = response.json()["query_media"]
        assert media["path"].startswith(f"collections/{collection_id}/queries/")
        assert media["media_type"] == "image/png"
        assert media["width"] > 0
        assert media["height"] > 0
        asset = client.get(f"/api/collections/{collection_id}/assets/{media['path']}")
        assert asset.status_code == 200
