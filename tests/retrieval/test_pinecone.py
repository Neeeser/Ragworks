from __future__ import annotations

from typing import Any

import pytest

from app.retrieval import pinecone as pinecone_module
from app.retrieval.pinecone import get_pinecone_client


def test_get_pinecone_client_returns_injected_client_as_is() -> None:
    sentinel = object()

    assert get_pinecone_client(client=sentinel, api_key="unused") is sentinel


def test_get_pinecone_client_requires_api_key_when_client_missing() -> None:
    with pytest.raises(ValueError, match="Pinecone API key must be provided"):
        get_pinecone_client(client=None, api_key=None)


def test_get_pinecone_client_constructs_from_api_key(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class _StubPinecone:
        def __init__(self, api_key: str) -> None:
            captured["api_key"] = api_key

    monkeypatch.setattr(pinecone_module, "Pinecone", _StubPinecone)

    client = get_pinecone_client(client=None, api_key="  unit-key  ")

    assert isinstance(client, _StubPinecone)
    assert captured["api_key"] == "unit-key"
