"""Transport behavior for the typed Cohere HTTP client."""

from __future__ import annotations

import json

import httpx
import pytest


def _client(handler: httpx.MockTransport):
    """Build a Cohere client backed by an in-memory HTTP transport."""
    from app.clients.cohere.client import CohereClient

    client = CohereClient("test-key")
    client._http = httpx.Client(
        base_url="https://cohere.test",
        headers={"Authorization": "Bearer test-key"},
        transport=handler,
    )
    return client


def test_client_rejects_blank_api_key() -> None:
    """A provider connection cannot create a client without a secret."""
    from app.clients.cohere.client import CohereClient

    with pytest.raises(ValueError, match="API key"):
        CohereClient("  ")


def test_list_models_paginates_and_filters_by_endpoint() -> None:
    """Catalogs include every page from Cohere's endpoint-specific listing."""
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params))
        if request.url.params.get("page_token"):
            return httpx.Response(
                200,
                json={
                    "models": [
                        {"name": "command-r", "endpoints": ["chat"], "context_length": 128000}
                    ]
                },
            )
        return httpx.Response(
            200,
            json={
                "models": [
                    {"name": "command-a", "endpoints": ["chat"], "context_length": 256000}
                ],
                "next_page_token": "second-page",
            },
        )

    models = _client(httpx.MockTransport(handler)).list_models("chat").value

    assert [model.name for model in models] == ["command-a", "command-r"]
    assert seen == [
        {"endpoint": "chat", "page_size": "1000"},
        {"endpoint": "chat", "page_size": "1000", "page_token": "second-page"},
    ]


def test_embed_sends_input_type_and_optional_output_dimension() -> None:
    """The v2 embed transport preserves asymmetric retrieval input types."""
    bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "embeddings": {"float": [[0.1, 0.2]]},
                "meta": {"billed_units": {"input_tokens": 3}},
            },
        )

    response = _client(httpx.MockTransport(handler)).embed(
        ["hello"],
        model="embed-v4.0",
        input_type="search_query",
        output_dimension=1024,
    )

    assert response.embeddings.values == [[0.1, 0.2]]
    assert bodies == [
        {
            "texts": ["hello"],
            "model": "embed-v4.0",
            "input_type": "search_query",
            "embedding_types": ["float"],
            "output_dimension": 1024,
        }
    ]


def test_chat_stream_parses_sse_events() -> None:
    """SSE frames become typed stream events; the terminal ``[DONE]`` is skipped.

    The frame list mirrors a captured live v2 stream tail: Cohere always closes
    the stream with a bare ``data: [DONE]`` sentinel after ``message-end``.
    Regression: parsing it as JSON raised mid-stream on every streamed turn.
    """
    frames = "\n\n".join(
        [
            'event: content-delta\ndata: {"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"Hi"}}}}',
            'event: message-end\ndata: {"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{"tokens":{"input_tokens":2,"output_tokens":1}}}}',
            "data: [DONE]",
        ]
    )

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=frames + "\n\n")

    events = list(
        _client(httpx.MockTransport(handler)).chat_stream(
            [{"role": "user", "content": "hello"}], model="command-a"
        )
    )

    assert [event.type for event in events] == ["content-delta", "message-end"]
    assert events[0].delta.message is not None
    assert events[0].delta.message.content is not None
    assert events[0].delta.message.content.text == "Hi"


def test_chat_stream_non_2xx_is_classified_as_an_external_provider_error() -> None:
    """A real failed Cohere response surfaces through the shared external mapping."""
    from app.services.errors import is_external_provider_error

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "temporarily unavailable"})

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        list(
            client.chat_stream(
                [{"role": "user", "content": "hello"}], model="command-a"
            )
        )

    assert exc_info.value.response.status_code == 503
    assert is_external_provider_error(exc_info.value) is True


def test_rerank_requests_every_candidate_and_surfaces_status_errors() -> None:
    """Reranking asks Cohere for a complete ranking and preserves HTTP failures."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["top_n"] == 2
        return httpx.Response(429, json={"message": "rate limited"})

    with pytest.raises(httpx.HTTPStatusError):
        _client(httpx.MockTransport(handler)).rerank(
            model="rerank-v4.0-fast", query="query", documents=["one", "two"]
        )
