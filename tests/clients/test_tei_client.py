"""Behavior tests for the TEI HTTP client."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.clients.tei import (
    TEIClient,
    close_tei_clients,
    get_tei_client,
    invalidate_tei_client,
)


def _build_client(handler: httpx.MockTransport) -> TEIClient:
    client = TEIClient("http://tei.test:8080///", api_key="proxy-token")
    client._http = httpx.Client(
        base_url="http://tei.test:8080",
        headers={"Authorization": "Bearer proxy-token"},
        transport=handler,
    )
    return client


def test_client_rejects_an_empty_server_url() -> None:
    """A connection cannot defer a missing TEI endpoint until its first request."""
    with pytest.raises(ValueError, match="base URL must be provided"):
        TEIClient("   ")


def test_info_normalizes_url_and_sends_optional_bearer_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("Authorization", "")
        return httpx.Response(
            200,
            json={
                "model_id": "BAAI/bge-base-en-v1.5",
                "model_type": {"embedding": {"pooling": "mean"}},
                "max_input_length": 512,
            },
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client

    def client_with_transport(**kwargs: Any) -> httpx.Client:
        return http_client(transport=transport, **kwargs)

    monkeypatch.setattr(httpx, "Client", client_with_transport)
    info = TEIClient("http://tei.test:8080///", api_key="proxy-token").info()

    assert seen == {
        "url": "http://tei.test:8080/info",
        "authorization": "Bearer proxy-token",
    }
    assert info.model_id == "BAAI/bge-base-en-v1.5"
    assert info.model_type == {"embedding": {"pooling": "mean"}}
    assert info.max_input_length == 512


def test_embed_posts_text_inputs_and_parses_bare_vectors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/embed"
        assert json.loads(request.content) == {"inputs": ["alpha", "beta"]}
        return httpx.Response(200, json=[[0.1, 0.2], [0.3, 0.4]])

    response = _build_client(httpx.MockTransport(handler)).embed(["alpha", "beta"])

    assert response == [[0.1, 0.2], [0.3, 0.4]]


def test_rerank_posts_query_and_texts_and_parses_indexed_scores() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rerank"
        assert json.loads(request.content) == {"query": "query", "texts": ["alpha", "beta"]}
        return httpx.Response(200, json=[{"index": 1, "score": 0.8}, {"index": 0, "score": 0.2}])

    response = _build_client(httpx.MockTransport(handler)).rerank("query", ["alpha", "beta"])

    assert [(item.index, item.score) for item in response] == [(1, 0.8), (0, 0.2)]


def test_cached_clients_are_normalized_and_closed_when_connections_change() -> None:
    """Connection edits retire the matching shared HTTP client without touching peers."""
    close_tei_clients()
    first = get_tei_client(" http://tei.test:8080/// ", " proxy-token ")
    same_connection = get_tei_client("http://tei.test:8080", "proxy-token")

    assert same_connection is first
    assert invalidate_tei_client("http://tei.test:8080/", "proxy-token") is True
    assert first._http.is_closed is True
    assert invalidate_tei_client("http://tei.test:8080", "proxy-token") is False

    retained = get_tei_client("http://another-tei.test:8080")
    close_tei_clients()

    assert retained._http.is_closed is True
