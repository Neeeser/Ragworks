from __future__ import annotations

from typing import Any

import pytest

from app.clients.pinecone import IndexDescription, PineconeIndexAdmin, get_pinecone_client
from app.clients.pinecone import client as pinecone_client_module


class _StubPinecone:
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


class _StubIndexModel:
    """Mimics the SDK's `IndexModel`: no dict/Mapping interface, only `to_dict()`."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def to_dict(self) -> dict[str, Any]:
        return dict(self._payload)


def test_get_pinecone_client_requires_api_key() -> None:
    with pytest.raises(ValueError, match="Pinecone API key must be provided"):
        get_pinecone_client("")


def test_get_pinecone_client_strips_and_constructs(monkeypatch) -> None:
    captured: dict[str, str] = {}

    class _StubPineconeSDK:
        def __init__(self, api_key: str) -> None:
            captured["api_key"] = api_key

    monkeypatch.setattr(pinecone_client_module, "Pinecone", _StubPineconeSDK)

    client = get_pinecone_client("  unit-key  ")

    assert isinstance(client, _StubPineconeSDK)
    assert captured["api_key"] == "unit-key"


def test_list_indexes_returns_typed_descriptions() -> None:
    admin = PineconeIndexAdmin(_StubPinecone())

    indexes = admin.list_indexes()

    assert indexes == [
        IndexDescription(
            name="alpha",
            metric="cosine",
            dimension=1536,
            vector_type="dense",
            status={"ready": True, "state": "Ready"},
            spec={"serverless": {"cloud": "aws", "region": "us-east-1"}},
        )
    ]


def test_list_indexes_handles_to_dict_only_objects() -> None:
    """`IndexModel` (the real SDK return type) exposes `to_dict()`, not `Mapping`."""

    class _StubPineconeToDict:
        def list_indexes(self) -> list[_StubIndexModel]:
            return [_StubIndexModel({"name": "beta", "vector_type": "sparse"})]

    admin = PineconeIndexAdmin(_StubPineconeToDict())

    indexes = admin.list_indexes()

    assert indexes == [IndexDescription(name="beta", vector_type="sparse")]


def test_describe_index_returns_typed_description() -> None:
    admin = PineconeIndexAdmin(_StubPinecone())

    description = admin.describe_index("alpha")

    assert description.name == "alpha"
    assert description.vector_type == "dense"


def test_create_index_passes_through_all_fields_and_describes() -> None:
    client = _StubPinecone()
    admin = PineconeIndexAdmin(client)

    description = admin.create_index(
        name="alpha",
        vector_type="dense",
        metric="cosine",
        cloud="aws",
        region="us-east-1",
        dimension=768,
        deletion_protection="enabled",
        tags={"env": "test"},
    )

    assert description.name == "alpha"
    assert client.created is not None
    assert client.created["name"] == "alpha"
    assert client.created["dimension"] == 768
    assert client.created["deletion_protection"] == "enabled"
    assert client.created["tags"] == {"env": "test"}
    assert client.created["spec"].cloud == "aws"  # type: ignore[union-attr]
    assert client.created["spec"].region == "us-east-1"  # type: ignore[union-attr]


def test_create_index_allows_sparse_without_dimension() -> None:
    client = _StubPinecone()
    admin = PineconeIndexAdmin(client)

    admin.create_index(
        name="sparse-index",
        vector_type="sparse",
        metric="dotproduct",
        cloud="aws",
        region="us-east-1",
    )

    assert client.created is not None
    # `dimension=None` is passed through explicitly rather than omitted -- the
    # installed SDK's request factory drops `None` args before building the
    # request, so this is behaviorally identical to omission (see client.py).
    assert client.created["dimension"] is None


def test_delete_index_delegates_to_client() -> None:
    client = _StubPinecone()
    admin = PineconeIndexAdmin(client)

    admin.delete_index("alpha")

    assert client.deleted == "alpha"
