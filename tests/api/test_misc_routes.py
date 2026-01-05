from __future__ import annotations

import asyncio
from uuid import uuid4

import io
import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import Session

from app.api.routes import documents as documents_routes
from app.api.routes import health as health_routes
from app.api.routes import models as models_routes
from app.api.routes import search as search_routes
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.models import (
    EmbeddingDimensionResponse,
    EmbeddingModelInfo,
    EndpointsListResponse,
    ListEndpointsResponse,
    ModelInfo,
)
from app.schemas.retrieval import CollectionQueryRequest


class _StubOpenRouter:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def list_models(self, force_refresh: bool = False):
        self.calls.append({"force_refresh": force_refresh})
        return [ModelInfo(id="model-a", name="Model A")]

    def list_model_endpoints(self, author: str, slug: str):
        self.calls.append({"author": author, "slug": slug})
        return EndpointsListResponse(data=ListEndpointsResponse(id="model-a", name="Model A"))

    def list_embedding_models(self, force_refresh: bool = False):
        self.calls.append({"embedding_refresh": force_refresh})
        return [{"id": "embed-a", "name": "Embed A"}]

    def get_embedding_dimension(self, model_id: str) -> int:
        self.calls.append({"embedding_dimension": model_id})
        return 1536


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_healthcheck_includes_timestamp() -> None:
    payload = health_routes.healthcheck()

    assert payload["status"] == "ok"
    assert payload["timestamp"].endswith("Z")


def test_models_routes_delegate_to_openrouter(monkeypatch) -> None:
    client = _StubOpenRouter()
    monkeypatch.setattr(models_routes, "get_openrouter_client", lambda *_args, **_kwargs: client)

    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
    )

    model_list = models_routes.list_models(refresh=True, current_user=user)
    endpoints = models_routes.list_model_endpoints("openai", "gpt-4", current_user=user)
    embedding_models = models_routes.list_embedding_models(refresh=True, current_user=user)
    embedding_dimension = models_routes.get_embedding_dimension(
        model="embed-a",
        current_user=user,
    )

    assert model_list[0].id == "model-a"
    assert endpoints.data.id == "model-a"
    assert embedding_models == [EmbeddingModelInfo(id="embed-a", name="Embed A")]
    assert embedding_dimension == EmbeddingDimensionResponse(model="embed-a", dimension=1536)
    assert client.calls[0]["force_refresh"] is True


def test_list_embedding_models_skips_invalid_entries(monkeypatch) -> None:
    class _StubEmbeddingClient:
        def list_embedding_models(self, force_refresh: bool = False):
            return ["invalid", {"id": ""}, {"id": "embed-a", "name": "Embed A"}]

    monkeypatch.setattr(
        models_routes,
        "get_openrouter_client",
        lambda *_args, **_kwargs: _StubEmbeddingClient(),
    )

    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
    )

    embedding_models = models_routes.list_embedding_models(refresh=False, current_user=user)

    assert embedding_models == [EmbeddingModelInfo(id="embed-a", name="Embed A")]


def test_search_route_raises_for_missing_collection(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        search_routes.run_collection_query(
            uuid4(),
            CollectionQueryRequest(query="test", top_k=5),
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 404


def test_documents_routes_raise_for_missing_collection_and_document(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        documents_routes.list_documents(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        documents_routes.get_document_chunks(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_upload_document_raises_for_missing_collection(session: Session) -> None:
    user = _create_user(session)
    upload = UploadFile(filename="doc.txt", file=io.BytesIO(b"data"))

    async def _call():
        return await documents_routes.upload_document(
            uuid4(),
            upload,
            current_user=user,
            session=session,
        )

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(_call())

    assert excinfo.value.status_code == 404
