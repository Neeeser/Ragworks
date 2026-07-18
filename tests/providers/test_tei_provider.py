"""Behavior tests for TEI provider capability detection."""

from __future__ import annotations

import json
from collections.abc import Callable
from uuid import uuid4

import httpx
import pytest

from app.clients.tei import TEIClient
from app.clients.tei.schemas import TEIInfo
from app.db import models
from app.providers import tei as tei_module
from app.providers.tei import TEIAdapter
from app.retrieval.embedders.tei_embedder import TEIEmbedder
from app.retrieval.rerankers.tei import TEIReranker
from app.schemas.enums import ProviderKind, ProviderType
from app.services.errors import InvalidInputError


def _connection() -> models.ProviderConnection:
    return models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.TEI.value,
        label="TEI",
        config={"base_url": "http://tei.test:8080"},
    )


def _client(handler: httpx.MockTransport) -> TEIClient:
    """Build a TEI client whose external boundary stays in memory."""
    client = TEIClient("http://tei.test:8080")
    client._http = httpx.Client(base_url="http://tei.test:8080", transport=handler)
    return client


def _adapter(monkeypatch: pytest.MonkeyPatch, client: TEIClient) -> TEIAdapter:
    """Bind an adapter to the supplied TEI client boundary."""
    monkeypatch.setattr(tei_module, "get_tei_client", lambda _url, _key: client)
    return TEIAdapter(_connection())


def _info_response(
    request: httpx.Request,
    *,
    model_id: str = "BAAI/example",
    model_type: dict[str, object] | None = None,
    max_input_length: int | None = 512,
) -> httpx.Response:
    """Return a representative TEI ``/info`` response."""
    return httpx.Response(
        200,
        json={
            "model_id": model_id,
            "model_type": model_type or {"embedding": {"pooling": "mean"}},
            "max_input_length": max_input_length,
        },
        request=request,
    )


def test_descriptor_explains_one_model_per_connection() -> None:
    base_url = next(
        field for field in TEIAdapter.descriptor.config_fields if field.name == "base_url"
    )

    assert base_url.description == "Each TEI connection serves one model and task."


def test_adapter_caches_served_capability_until_a_catalog_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A forced catalog refresh observes a changed TEI server without extra probes."""
    infos = [
        {"model_id": "acme/embed-v1", "max_input_length": 512},
        {"model_id": "acme/embed-v2", "max_input_length": 1024},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/info"
        return _info_response(request, **infos.pop(0))

    adapter = _adapter(monkeypatch, _client(httpx.MockTransport(handler)))

    assert adapter.kinds == (ProviderKind.EMBEDDING,)
    assert adapter.list_models(ProviderKind.EMBEDDING).models[0].id == "acme/embed-v1"
    refreshed = adapter.list_models(ProviderKind.EMBEDDING, force_refresh=True)

    assert refreshed.models[0].id == "acme/embed-v2"
    assert refreshed.models[0].max_input_tokens == 1024
    assert infos == []


ProbeHandler = Callable[[httpx.Request], httpx.Response]


def _unreachable(request: httpx.Request) -> httpx.Response:
    """Model a transport failure before TEI can return a response."""
    raise httpx.ConnectError("TEI is offline", request=request)


@pytest.mark.parametrize(
    ("handler", "expected"),
    [
        (
            lambda request: _info_response(request, model_id="acme/embed"),
            (True, "Connected (acme/embed, embedding)."),
        ),
        (
            lambda request: _info_response(
                request, model_type={"classifier": {"id2label": {"0": "negative"}}}
            ),
            (False, "unsupported model_type"),
        ),
        (
            lambda request: httpx.Response(401, request=request),
            (False, "rejected the API key"),
        ),
        (
            lambda request: httpx.Response(503, request=request),
            (False, "TEI validation failed."),
        ),
        (_unreachable, (False, "TEI server is unreachable")),
    ],
)
def test_validation_classifies_tei_probe_outcomes(
    monkeypatch: pytest.MonkeyPatch,
    handler: ProbeHandler,
    expected: tuple[bool, str],
) -> None:
    """Connection checks distinguish supported, rejected, broken, and unreachable TEI."""
    result = _adapter(monkeypatch, _client(httpx.MockTransport(handler))).validate_connection()

    assert result.valid is expected[0]
    assert expected[1] in result.message


def test_embedding_factory_uses_the_served_model_and_native_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TEI embedding selection is one served model with a measured native dimension."""
    embed_requests: list[dict[str, list[str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/info":
            return _info_response(request, model_id="acme/embed", max_input_length=512)
        assert request.url.path == "/embed"
        embed_requests.append(json.loads(request.content))
        return httpx.Response(200, json=[[0.1, 0.2, 0.3]], request=request)

    adapter = _adapter(monkeypatch, _client(httpx.MockTransport(handler)))
    embedder = adapter.embedder("acme/embed", dimensions=1536)

    assert isinstance(embedder, TEIEmbedder)
    assert embedder.model_name == "acme/embed"
    assert adapter.embedding_dimension("acme/embed") == 3
    assert adapter.embedding_input_limit("acme/embed") == 512
    assert embed_requests == [{"inputs": ["dimension_probe"]}]


def test_embedding_dimension_is_unknown_when_tei_returns_no_vector(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful but empty probe leaves embedding dimension unavailable."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/info":
            return _info_response(request)
        assert request.url.path == "/embed"
        return httpx.Response(200, json=[], request=request)

    adapter = _adapter(monkeypatch, _client(httpx.MockTransport(handler)))

    assert adapter.embedding_dimension("BAAI/example") is None


def test_factories_reject_stale_models_and_incompatible_tei_tasks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A reranker server cannot be used for embedding or a previously served model."""
    def handler(request: httpx.Request) -> httpx.Response:
        return _info_response(
            request,
            model_id="acme/rerank",
            model_type={"reranker": {"id2label": {"0": "not relevant"}}},
        )

    adapter = _adapter(monkeypatch, _client(httpx.MockTransport(handler)))

    with pytest.raises(InvalidInputError, match="do not provide embedding"):
        adapter.embedder("acme/rerank")
    with pytest.raises(InvalidInputError, match="serves 'acme/rerank', not 'acme/old'"):
        adapter.reranker("acme/old")

    reranker = adapter.reranker("acme/rerank")

    assert isinstance(reranker, TEIReranker)


@pytest.mark.parametrize(
    ("model_type", "requested", "expected"),
    [
        ({"embedding": {"pooling": "mean"}}, ProviderKind.EMBEDDING, ProviderKind.EMBEDDING),
        ({"reranker": {"id2label": {"0": "not relevant"}}}, ProviderKind.RERANKING, ProviderKind.RERANKING),
    ],
)
def test_list_models_exposes_its_one_served_model_for_matching_task(
    monkeypatch: pytest.MonkeyPatch,
    model_type: dict[str, object],
    requested: ProviderKind,
    expected: ProviderKind,
) -> None:
    adapter = TEIAdapter(_connection())
    info = TEIInfo(
        model_id="BAAI/example",
        model_type=model_type,
        max_input_length=512,
    )
    monkeypatch.setattr(adapter, "_info", lambda _force_refresh=False: info)

    catalog = adapter.list_models(requested)

    assert len(catalog.models) == 1
    model = catalog.models[0]
    assert model.id == "BAAI/example"
    assert model.max_input_tokens == 512
    assert model.input_modalities == ["text"]
    assert model.output_modalities == (
        ["embedding"] if expected is ProviderKind.EMBEDDING else ["rerank"]
    )


def test_list_models_rejects_a_task_that_does_not_match_the_served_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = TEIAdapter(_connection())
    monkeypatch.setattr(
        adapter,
        "_info",
        lambda _force_refresh=False: TEIInfo(
            model_id="BAAI/bge-reranker-base",
            model_type={"reranker": {"id2label": {"0": "not relevant"}}},
            max_input_length=512,
        ),
    )

    with pytest.raises(InvalidInputError, match="does not serve embedding"):
        adapter.list_models(ProviderKind.EMBEDDING)


def test_list_models_rejects_a_non_reranking_classifier_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = TEIAdapter(_connection())
    monkeypatch.setattr(
        adapter,
        "_info",
        lambda _force_refresh=False: TEIInfo(
            model_id="acme/sentiment",
            model_type={"classifier": {"id2label": {"0": "negative", "1": "positive"}}},
            max_input_length=512,
        ),
    )

    with pytest.raises(InvalidInputError, match="unsupported model_type"):
        adapter.list_models(ProviderKind.RERANKING)
