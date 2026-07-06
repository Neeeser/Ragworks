from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from app.api.routes import indexes as indexes_routes
from app.db import models


def _create_user_with_key() -> models.User:
    return models.User(
        email="pinecone@example.com",
        full_name="Pinecone User",
        hashed_password="hashed",
        pinecone_api_key="pinecone-key",
    )


class _StubPinecone:
    """Mimics the shape `Pinecone.list_indexes()`/friends return: a plain iterable
    of dicts, matching what `IndexDescription.from_sdk` expects at the client edge."""

    def __init__(self) -> None:
        self.created: dict[str, Any] | None = None
        self.deleted: str | None = None

    def list_indexes(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "alpha",
                "metric": "cosine",
                "dimension": 1536,
                "vector_type": "dense",
                "status": {"ready": True, "state": "Ready"},
                "spec": {"serverless": {"cloud": "aws", "region": "us-east-1"}},
            }
        ]

    def describe_index(self, name: str) -> dict[str, Any]:
        return {"name": name, "metric": "cosine", "vector_type": "dense"}

    def create_index(self, **kwargs: Any) -> None:
        self.created = kwargs

    def delete_index(self, name: str) -> None:
        self.deleted = name


def test_list_indexes_requires_key() -> None:
    user = models.User(email="no-key@example.com", full_name="No Key", hashed_password="hashed")

    with pytest.raises(HTTPException) as excinfo:
        indexes_routes.list_indexes(current_user=user)

    assert excinfo.value.status_code == 400


def test_list_indexes_returns_serialized(monkeypatch) -> None:
    monkeypatch.setattr(indexes_routes, "get_pinecone_client", lambda _api_key: _StubPinecone())

    response = indexes_routes.list_indexes(current_user=_create_user_with_key())

    assert response.indexes
    assert response.indexes[0].name == "alpha"


def test_describe_index_returns_entry(monkeypatch) -> None:
    monkeypatch.setattr(indexes_routes, "get_pinecone_client", lambda _api_key: _StubPinecone())

    response = indexes_routes.describe_index("alpha", current_user=_create_user_with_key())

    assert response.name == "alpha"


def test_describe_index_missing_raises_404(monkeypatch) -> None:
    class _StubMissing:
        def describe_index(self, name: str) -> None:
            raise KeyError(f"no such index: {name}")

    monkeypatch.setattr(indexes_routes, "get_pinecone_client", lambda _api_key: _StubMissing())

    with pytest.raises(HTTPException) as excinfo:
        indexes_routes.describe_index("missing", current_user=_create_user_with_key())

    assert excinfo.value.status_code == 404


def test_create_index_uses_defaults(monkeypatch) -> None:
    stub = _StubPinecone()
    monkeypatch.setattr(indexes_routes, "get_pinecone_client", lambda _api_key: stub)

    payload = indexes_routes.PineconeIndexCreateRequest(
        name="alpha",
        dimension=768,
        metric="cosine",
        vector_type="dense",
        deletion_protection="enabled",
        tags={"env": "test"},
    )
    response = indexes_routes.create_index(payload, current_user=_create_user_with_key())

    assert response.name == "alpha"
    assert stub.created is not None
    assert stub.created["name"] == "alpha"
    assert stub.created["dimension"] == 768
    assert stub.created["deletion_protection"] == "enabled"
    assert stub.created["tags"] == {"env": "test"}


def test_create_index_allows_sparse_without_dimension(monkeypatch) -> None:
    stub = _StubPinecone()
    monkeypatch.setattr(indexes_routes, "get_pinecone_client", lambda _api_key: stub)

    payload = indexes_routes.PineconeIndexCreateRequest(
        name="sparse-index",
        vector_type="sparse",
        metric="dotproduct",
    )
    response = indexes_routes.create_index(payload, current_user=_create_user_with_key())

    assert response.name == "sparse-index"
    assert stub.created is not None
    # dimension is passed through as None rather than omitted -- see
    # PineconeIndexAdmin.create_index for why that's behaviorally identical.
    assert stub.created["dimension"] is None


def test_delete_index_returns_deleted_response(monkeypatch) -> None:
    monkeypatch.setattr(indexes_routes, "get_pinecone_client", lambda _api_key: _StubPinecone())

    response = indexes_routes.delete_index("alpha", current_user=_create_user_with_key())

    assert response.status == "deleted"
