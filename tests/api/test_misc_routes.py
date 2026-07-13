from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import documents as documents_routes
from app.api.routes import health as health_routes
from app.api.routes import search as search_routes
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.models import (
    EmbeddingModelInfo,
    EndpointsListResponse,
    ListEndpointsResponse,
    ModelInfo,
)
from app.schemas.retrieval import CollectionQueryRequest
from app.services.errors import InvalidInputError


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
        return [EmbeddingModelInfo(id="embed-a", name="Embed A", dimension=1536)]


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_healthcheck_includes_timestamp() -> None:
    payload = health_routes.healthcheck()

    assert payload["status"] == "ok"
    assert payload["timestamp"].endswith("Z")



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


def test_search_route_translates_retrieval_value_error(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    class _StubRetrievalService:
        def __init__(self, _session) -> None:
            pass

        def query_collection(self, _user, _collection, *, query, top_k):
            raise InvalidInputError("Retrieval pipeline could not be resolved.")

    monkeypatch.setattr(search_routes, "RetrievalService", _StubRetrievalService)

    with pytest.raises(HTTPException) as excinfo:
        search_routes.run_collection_query(
            collection.id,
            CollectionQueryRequest(query="test", top_k=5),
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 400
