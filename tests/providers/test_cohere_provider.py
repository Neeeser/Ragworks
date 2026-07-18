"""Adapter-level behavior for a configured Cohere provider connection."""

from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest

from app.cache import CacheSnapshot
from app.clients.cohere import CohereClient
from app.clients.cohere.schemas import CohereModel
from app.db import models
from app.providers import cohere as cohere_module
from app.providers.chat.cohere import CohereChatProvider
from app.providers.cohere import CohereAdapter
from app.retrieval.embedders.cohere_embedder import CohereEmbedder
from app.retrieval.models import DocumentChunk, ScoredChunk
from app.retrieval.rerankers.cohere import CohereReranker
from app.schemas.enums import ProviderKind, ProviderType


def _connection() -> models.ProviderConnection:
    """Build a Cohere connection without persisting credentials."""
    return models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.COHERE.value,
        label="Cohere test",
        config={"api_key": "test-key"},
    )


def _client(handler: httpx.MockTransport) -> CohereClient:
    """Build a Cohere client backed by a deterministic in-memory transport."""
    client = CohereClient("test-key")
    client._http = httpx.Client(base_url="https://cohere.test", transport=handler)
    return client


def _adapter(
    monkeypatch: pytest.MonkeyPatch, client: CohereClient
) -> CohereAdapter:
    """Bind an adapter to the supplied boundary client."""
    monkeypatch.setattr(cohere_module, "get_cohere_client", lambda _key: client)
    return CohereAdapter(_connection())


def _candidate(text: str, index: int) -> ScoredChunk:
    """Build one candidate for adapter-created reranker tests."""
    return ScoredChunk(
        chunk=DocumentChunk(
            document_id="doc",
            chunk_id=f"chunk-{index}",
            text=text,
            order=index,
        ),
        score=0.0,
    )


def test_validation_reports_connected_and_rejected_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Credential validation distinguishes a working catalog from a 401."""
    valid = _adapter(
        monkeypatch,
        _client(httpx.MockTransport(lambda _: httpx.Response(200, json={"models": []}))),
    ).validate_connection()
    assert valid.valid is True
    assert valid.message == "Connected."

    invalid = _adapter(
        monkeypatch,
        _client(
            httpx.MockTransport(
                lambda _: httpx.Response(401, json={"message": "invalid api key"})
            )
        ),
    ).validate_connection()
    assert invalid.valid is False
    assert invalid.message == "Invalid Cohere API key."


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (httpx.Response(500, json={"message": "upstream error"}), "Cohere validation failed."),
        (httpx.ConnectError("connection refused"), "Cohere is unreachable."),
    ],
)
def test_validation_normalizes_non_authentication_provider_failures(
    monkeypatch: pytest.MonkeyPatch,
    failure: httpx.Response | httpx.ConnectError,
    message: str,
) -> None:
    """Validation does not mislabel server failures or network outages as bad keys."""

    def handler(_: httpx.Request) -> httpx.Response:
        if isinstance(failure, Exception):
            raise failure
        return failure

    result = _adapter(monkeypatch, _client(httpx.MockTransport(handler))).validate_connection()

    assert result.valid is False
    assert result.message == message


def test_catalog_paginates_filters_and_exposes_capability_modalities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Adapter catalogs preserve endpoint pagination, freshness, and model I/O."""
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        seen.append(params)
        endpoint = params["endpoint"]
        if endpoint == "rerank" and "page_token" not in params:
            return httpx.Response(
                200,
                json={
                    "models": [{"name": "rerank-v4.0-fast", "context_length": 32768}],
                    "next_page_token": "next",
                },
            )
        return httpx.Response(
            200,
            json={"models": [{"name": f"{endpoint}-second", "context_length": 4096}]},
        )

    adapter = _adapter(monkeypatch, _client(httpx.MockTransport(handler)))
    chat = adapter.list_models(ProviderKind.CHAT)
    embedding = adapter.list_models(ProviderKind.EMBEDDING)
    reranking = adapter.list_models(ProviderKind.RERANKING)

    assert chat.models[0].input_modalities == ["text"]
    assert chat.models[0].output_modalities == ["text"]
    assert embedding.models[0].input_modalities == ["text"]
    assert embedding.models[0].output_modalities == ["embedding"]
    assert [model.id for model in reranking.models] == [
        "rerank-v4.0-fast",
        "rerank-second",
    ]
    assert reranking.models[0].input_modalities == ["text"]
    assert reranking.models[0].output_modalities == ["rerank"]
    assert reranking.meta.freshness == "fresh"
    assert reranking.meta.warning is None
    assert seen == [
        {"endpoint": "chat", "page_size": "1000"},
        {"endpoint": "embed", "page_size": "1000"},
        {"endpoint": "rerank", "page_size": "1000"},
        {"endpoint": "rerank", "page_size": "1000", "page_token": "next"},
    ]


def test_adapter_factories_bind_the_connection_client_and_model_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Adapter factories preserve the requested model and optional dimensions."""
    client = _client(httpx.MockTransport(lambda _: httpx.Response(200, json={"models": []})))
    adapter = _adapter(monkeypatch, client)

    embedder = adapter.embedder("embed-v4.0", dimensions=1024)
    chat = adapter.chat_provider()
    reranker = adapter.reranker("rerank-v4.0-fast")

    assert isinstance(embedder, CohereEmbedder)
    assert embedder.model_name == "embed-v4.0"
    assert embedder.dimensions == 1024
    assert isinstance(chat, CohereChatProvider)
    assert chat.name == "cohere"
    assert isinstance(reranker, CohereReranker)
    assert reranker.model_name == "rerank-v4.0-fast"


def test_embedding_dimension_uses_catalog_then_probes_as_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Known native dimensions avoid calls; unknown dimensions are measured once."""
    probe_calls: list[dict[str, object]] = []

    def catalog_dimension(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200,
            json={"models": [{"name": "embed-v4.0", "output_dimension": 1536}]},
        )

    catalog_adapter = _adapter(
        monkeypatch, _client(httpx.MockTransport(catalog_dimension))
    )
    assert catalog_adapter.embedding_dimension("embed-v4.0") == 1536

    def probe_dimension(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"models": [{"name": "embed-v3.0"}]})
        probe_calls.append(json.loads(request.content))
        return httpx.Response(200, json={"embeddings": {"float": [[0.1, 0.2, 0.3]]}})

    probe_adapter = _adapter(
        monkeypatch, _client(httpx.MockTransport(probe_dimension))
    )
    assert probe_adapter.embedding_dimension("embed-v3.0") == 3
    assert probe_calls == [
        {
            "texts": ["dimension_probe"],
            "model": "embed-v3.0",
            "input_type": "search_document",
            "embedding_types": ["float"],
        }
    ]


def test_embedding_dimension_and_input_limit_return_none_without_model_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unknown catalog entries do not invent a dimension or input-token limit."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json={"models": [{"name": "embed-v4.0", "context_length": 8192}]},
            )
        return httpx.Response(200, json={"embeddings": {"float": []}})

    adapter = _adapter(monkeypatch, _client(httpx.MockTransport(handler)))

    assert adapter.embedding_input_limit("EMBED-V4.0") == 8192
    assert adapter.embedding_input_limit("missing-model") is None
    assert adapter.embedding_dimension("missing-model") is None


def test_embedding_input_limit_propagates_catalog_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Input-limit discovery retains provider catalog failures for the caller."""

    class Client:
        @staticmethod
        def list_models(*_args: object, **_kwargs: object) -> CacheSnapshot[list[CohereModel]]:
            raise RuntimeError("catalog unavailable")

    with pytest.raises(RuntimeError, match="catalog unavailable"):
        _adapter(monkeypatch, Client()).embedding_input_limit("embed-v4.0")  # type: ignore[arg-type]


def test_adapter_reranker_orders_complete_results_and_rejects_non_finite_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An adapter-created reranker preserves valid order and rejects NaN scores."""
    responses = [
        {
            "results": [
                {"index": 1, "relevance_score": 0.9},
                {"index": 0, "relevance_score": 0.2},
            ]
        },
        {
            "results": [
                {"index": 0, "relevance_score": "NaN"},
                {"index": 1, "relevance_score": 0.2},
            ]
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["top_n"] == 2
        return httpx.Response(200, json=responses.pop(0))

    reranker = _adapter(
        monkeypatch, _client(httpx.MockTransport(handler))
    ).reranker("rerank-v4.0-fast")
    candidates = [_candidate("alpha", 0), _candidate("beta", 1)]

    ranked = reranker.rerank("query", candidates)
    assert [(item.chunk.text, item.score) for item in ranked] == [
        ("beta", 0.9),
        ("alpha", 0.2),
    ]
    with pytest.raises(ValueError, match="finite"):
        reranker.rerank("query", candidates)
