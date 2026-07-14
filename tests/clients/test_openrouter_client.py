from __future__ import annotations

from dataclasses import dataclass
from typing import Any, ClassVar

import pytest

from app.cache import ResourceCache
from app.clients.openrouter import OpenRouterClient
from app.clients.openrouter import client as openrouter_module
from app.schemas.models import EndpointsListResponse, ListEndpointsResponse, ModelInfo
from app.schemas.openrouter import OpenRouterEmbeddingsResponse


@dataclass
class _StubSettings:
    openrouter_api_key: str = "test-key"
    openrouter_base_url: str = "https://example.com/api/v1"
    openrouter_site_name: str = "Ragworks"
    openrouter_site_url: str = "https://ragworks.ai"
    default_embedding_model: str = "test-embed"
    default_chat_model: str = "test-chat"


class _StubResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return dict(self._payload)


class _StubHttpClient:
    responses: ClassVar[dict[str, list[dict[str, Any]]]] = {}

    def __init__(self, base_url: str, headers: dict[str, str], timeout: float) -> None:
        self.base_url = base_url
        self.headers = headers
        self.timeout = timeout
        self.get_calls: list[str] = []

    def get(self, path: str) -> _StubResponse:
        self.get_calls.append(path)
        payloads = self.responses.get(path)
        if not payloads:
            raise AssertionError(f"No response queued for {path}")
        return _StubResponse(payloads.pop(0))


class _StubModelDump:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def model_dump(self) -> dict[str, Any]:
        return dict(self._payload)


class _StubEmbeddings:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> _StubModelDump:
        self.calls.append(kwargs)
        return _StubModelDump({"data": [{"embedding": [0.1]}]})


class _StubCompletions:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any):
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return [_StubModelDump({"chunk": 1}), _StubModelDump({"chunk": 2})]
        return _StubModelDump({"id": "chat-1"})


class _StubChat:
    def __init__(self) -> None:
        self.completions = _StubCompletions()


class _StubOpenAI:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        http_client: Any = None,
        timeout: Any = None,
    ) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.http_client = http_client
        self.timeout = timeout
        self.embeddings = _StubEmbeddings()
        self.chat = _StubChat()


@pytest.fixture
def client(monkeypatch) -> OpenRouterClient:
    _StubHttpClient.responses = {}
    monkeypatch.setattr(openrouter_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(openrouter_module.httpx, "Client", _StubHttpClient)
    monkeypatch.setattr(openrouter_module, "OpenAI", _StubOpenAI)
    return OpenRouterClient("test-key")


def test_list_models_caches_and_refreshes(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {"data": [{"id": "model-a", "name": "Model A"}]},
            {"data": [{"id": "model-b", "name": "Model B"}]},
        ]
    }

    first = client.list_models()
    second = client.list_models()
    refreshed = client.list_models(force_refresh=True)

    assert [model.id for model in first.value] == ["model-a"]
    assert first.freshness == "fresh"
    assert [model.id for model in second.value] == ["model-a"]
    assert [model.id for model in refreshed.value] == ["model-b"]
    assert client._http.get_calls.count("/models") == 2


def test_get_model_refreshes_when_missing(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {"data": []},
            {"data": [{"id": "provider/model", "canonical_slug": "provider/model", "name": "Model"}]},
        ]
    }

    model = client.get_model("provider/model")

    assert isinstance(model, ModelInfo)
    assert model.id == "provider/model"
    assert client._http.get_calls.count("/models") == 2


def test_get_model_returns_none_for_empty_id(client: OpenRouterClient) -> None:
    assert client.get_model("") is None


def test_get_model_matches_case_insensitive(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {
                "data": [
                    {
                        "id": "OpenAI/GPT-4",
                        "canonical_slug": "openai/gpt-4",
                        "name": "GPT-4",
                    }
                ]
            }
        ]
    }

    model = client.get_model("openai/gpt-4")

    assert model
    assert model.id == "OpenAI/GPT-4"


def test_get_model_matches_canonical_slug_case_insensitive(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {
                "data": [
                    {
                        "id": "OpenAI/GPT-4",
                        "canonical_slug": "openai/gpt-4",
                        "name": "GPT-4",
                    }
                ]
            }
        ]
    }

    model = client.get_model("OPENAI/GPT-4")

    assert model
    assert model.id == "OpenAI/GPT-4"


def test_get_model_matches_canonical_slug_when_id_differs(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {
                "data": [
                    {
                        "id": "OpenAI/GPT-4-0314",
                        "canonical_slug": "openai/gpt-4",
                        "name": "GPT-4",
                    }
                ]
            }
        ]
    }

    model = client.get_model("OPENAI/GPT-4")

    assert model
    assert model.id == "OpenAI/GPT-4-0314"


def test_get_model_returns_none_when_missing(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {
                "data": [
                    {
                        "id": "OpenAI/GPT-4",
                        "canonical_slug": "openai/gpt-4",
                        "name": "GPT-4",
                    }
                ]
            },
            {
                "data": [
                    {
                        "id": "OpenAI/GPT-4",
                        "canonical_slug": "openai/gpt-4",
                        "name": "GPT-4",
                    }
                ]
            },
        ]
    }

    model = client.get_model("openai/gpt-5")

    assert model is None


def test_get_model_matches_id_case_insensitive_without_canonical(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {
                "data": [
                    {
                        "id": "OpenAI/TEST",
                        "canonical_slug": None,
                        "name": "Test Model",
                    }
                ]
            }
        ]
    }

    model = client.get_model("openai/test")

    assert model
    assert model.id == "OpenAI/TEST"


def test_get_current_key_returns_parsed_metadata(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/key": [
            {
                "data": {
                    "label": "test-label",
                    "limit": 10.0,
                    "usage": 1.5,
                    "usage_daily": 0.1,
                    "usage_weekly": 0.5,
                    "usage_monthly": 1.0,
                    "byok_usage": 0,
                    "byok_usage_daily": 0,
                    "byok_usage_weekly": 0,
                    "byok_usage_monthly": 0,
                    "is_free_tier": False,
                    "is_provisioning_key": False,
                    "limit_remaining": 8.5,
                    "limit_reset": None,
                    "include_byok_in_limit": True,
                    "rate_limit": {"requests": -1, "interval": "10s", "note": "legacy"},
                }
            }
        ],
    }

    key_info = client.get_current_key()

    assert key_info.data.label == "test-label"
    assert key_info.data.limit_remaining == 8.5
    assert key_info.data.rate_limit
    assert key_info.data.rate_limit.interval == "10s"
    assert client._http.get_calls == ["/key"]


def test_list_model_endpoints_encodes_path(client: OpenRouterClient) -> None:
    response = EndpointsListResponse(data=ListEndpointsResponse(id="model", name="Model"))
    _StubHttpClient.responses = {
        "/models/open%20ai/gpt%2F4/endpoints": [response.model_dump()],
    }

    payload = client.list_model_endpoints("open ai", "gpt/4")

    assert payload.data.id == "model"
    assert client._http.get_calls == ["/models/open%20ai/gpt%2F4/endpoints"]


def test_list_embedding_models_caches_and_refreshes(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/embeddings/models": [
            {"data": [{"id": "embed-a", "name": "Embed A"}]},
            {"data": [{"id": "embed-b", "name": "Embed B"}]},
        ]
    }

    first = client.list_embedding_models()
    second = client.list_embedding_models()
    refreshed = client.list_embedding_models(force_refresh=True)

    assert first.value[0].id == "embed-a"
    assert second.value[0].id == "embed-a"
    assert refreshed.value[0].id == "embed-b"
    assert client._http.get_calls.count("/embeddings/models") == 2


def test_list_embedding_models_handles_invalid_payload(client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/embeddings/models": [{"data": {"id": "embed-a"}}],
    }

    models = client.list_embedding_models()

    assert models.value == []


def test_list_embedding_models_skips_invalid_entries(client: OpenRouterClient) -> None:
    """Entries with no `id` are dropped: `EmbeddingModelInfo.id` is required.

    This replaces the old dict-shape test that kept a raw `{"name": "No Id"}`
    entry with no id -- once the fetch produces typed `EmbeddingModelInfo`
    directly, an id-less entry can't be represented and is skipped, matching
    what the `/models.py` route used to do by hand before this refactor.
    """
    _StubHttpClient.responses = {
        "/embeddings/models": [
            {"data": ["bad-entry", {"name": "No Id"}, {"id": "embed-a", "name": "Embed A"}]}
        ],
    }

    models = client.list_embedding_models()

    assert len(models.value) == 1
    assert models.value[0].id == "embed-a"
    assert models.value[0].dimension is None
    assert client._client.embeddings.calls == []


def test_list_embedding_models_never_eagerly_probes_dimensions(
    client: OpenRouterClient,
) -> None:
    _StubHttpClient.responses = {
        "/embeddings/models": [{"data": [{"id": "embed-a", "name": "Embed A"}]}],
    }
    models = client.list_embedding_models(force_refresh=True)

    assert models.value[0].dimension is None
    assert client._client.embeddings.calls == []


def test_get_embedding_dimension_returns_length(client: OpenRouterClient) -> None:
    dimension = client.get_embedding_dimension("model-a")

    assert dimension == 1


def test_embed_merges_extra_headers(client: OpenRouterClient) -> None:
    result = client.embed(["hello"], model="test-embed", extra_headers={"X-Extra": "value"})

    call = client._client.embeddings.calls[0]
    assert call["extra_headers"]["X-Extra"] == "value"
    assert call["extra_headers"]["X-Title"] == "Ragworks"
    assert result.data[0].embedding == [0.1]


def test_embed_includes_dimensions(client: OpenRouterClient) -> None:
    client.embed(["hello"], model="test-embed", dimensions=1536)

    call = client._client.embeddings.calls[0]
    assert call["dimensions"] == 1536


def test_get_embedding_dimension_raises_on_missing_model_id(client: OpenRouterClient) -> None:
    with pytest.raises(ValueError, match="must be provided"):
        client.get_embedding_dimension("")


def test_get_embedding_dimension_raises_on_invalid_payload(client: OpenRouterClient) -> None:
    def _stub_embed(*_args, **_kwargs):
        return OpenRouterEmbeddingsResponse(data=[])

    client.embed = _stub_embed  # type: ignore[assignment]

    with pytest.raises(ValueError, match="missing data array"):
        client.get_embedding_dimension("model-a")


def test_get_embedding_dimension_raises_on_missing_embedding(client: OpenRouterClient) -> None:
    def _stub_embed(*_args, **_kwargs):
        return OpenRouterEmbeddingsResponse(data=[{"embedding": "bad"}])

    client.embed = _stub_embed  # type: ignore[assignment]

    with pytest.raises(ValueError, match="missing embedding values"):
        client.get_embedding_dimension("model-a")


def test_chat_includes_parameters_and_extra_body(client: OpenRouterClient) -> None:
    payload = client.chat(
        messages=[{"role": "user", "content": "hi"}],
        model="test-chat",
        extra_body={"usage": {"include": True}},
        parameters={"temperature": 0.2, "top_p": None},
    )

    call = client._client.chat.completions.calls[0]
    assert call["temperature"] == 0.2
    assert "top_p" not in call
    assert call["extra_body"] == {"usage": {"include": True}}
    assert payload.id == "chat-1"


def test_chat_includes_tool_settings(client: OpenRouterClient) -> None:
    client.chat(
        messages=[{"role": "user", "content": "hi"}],
        model="test-chat",
        tools=[{"type": "function", "function": {"name": "tool"}}],
        tool_choice={"type": "function", "function": {"name": "tool"}},
        parallel_tool_calls=True,
    )

    call = client._client.chat.completions.calls[0]
    assert call["tools"]
    assert call["tool_choice"]["function"]["name"] == "tool"
    assert call["parallel_tool_calls"] is True


def test_chat_stream_yields_chunks(client: OpenRouterClient) -> None:
    chunks = list(
        client.chat_stream(messages=[{"role": "user", "content": "hi"}],
        model="test-chat", parameters={"top_p": 0.9})
    )

    call = client._client.chat.completions.calls[0]
    assert call["stream"] is True
    assert call["top_p"] == 0.9
    assert [chunk.model_extra for chunk in chunks] == [{"chunk": 1}, {"chunk": 2}]


def test_chat_stream_skips_none_parameters(client: OpenRouterClient) -> None:
    list(
        client.chat_stream(
            messages=[{"role": "user", "content": "hi"}],
        model="test-chat",
            parameters={"top_p": None, "temperature": 0.1},
        )
    )

    call = client._client.chat.completions.calls[0]
    assert call["temperature"] == 0.1
    assert "top_p" not in call


def test_build_app_headers_skips_referer(monkeypatch) -> None:
    @dataclass
    class _NoRefererSettings:
        openrouter_api_key: str = "test-key"
        openrouter_base_url: str = "https://example.com/api/v1"
        openrouter_site_name: str = "Ragworks"
        openrouter_site_url: str | None = None
        default_embedding_model: str = "test-embed"
        default_chat_model: str = "test-chat"

    _StubHttpClient.responses = {}
    monkeypatch.setattr(openrouter_module, "get_settings", lambda: _NoRefererSettings())
    monkeypatch.setattr(openrouter_module.httpx, "Client", _StubHttpClient)
    monkeypatch.setattr(openrouter_module, "OpenAI", _StubOpenAI)

    client = OpenRouterClient("test-key")

    assert "HTTP-Referer" not in client._app_headers


def test_chat_stream_includes_tool_settings(client: OpenRouterClient) -> None:
    chunks = list(
        client.chat_stream(
            messages=[{"role": "user", "content": "hi"}],
        model="test-chat",
            tools=[{"type": "function", "function": {"name": "tool"}}],
            tool_choice={"type": "function", "function": {"name": "tool"}},
            parallel_tool_calls=True,
            extra_body={"usage": {"include": True}},
        )
    )

    call = client._client.chat.completions.calls[0]
    assert call["tools"]
    assert call["tool_choice"]["function"]["name"] == "tool"
    assert call["parallel_tool_calls"] is True
    assert call["extra_body"] == {"usage": {"include": True}}
    assert [chunk.model_extra for chunk in chunks] == [{"chunk": 1}, {"chunk": 2}]


def test_openrouter_client_requires_api_key() -> None:
    with pytest.raises(ValueError, match="OpenRouter API key must be provided"):
        OpenRouterClient(" ")


def test_get_openrouter_client_closes_evicted_clients(monkeypatch) -> None:
    """Evicting a cached client from `get_openrouter_client` must close it.

    A bare `lru_cache` never calls `close()` on the httpx client it evicts, so the
    connection leaks. Insert more distinct keys than the cache can hold via the
    public getter and confirm the oldest client was closed, and that repeat lookups
    for the same key keep returning the same instance.
    """
    created: list[_StubCacheClient] = []

    class _StubCacheClient:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key
            self.closed = False
            created.append(self)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(openrouter_module, "OpenRouterClient", _StubCacheClient)
    # Isolated cache instance: mutating the module-level singleton would leave 64
    # stub entries in the production cache for the rest of the pytest session and
    # could evict (and close) a real cached client held by other fixtures.
    monkeypatch.setattr(
        openrouter_module,
        "_client_cache",
        ResourceCache(max_entries=64, key_material=lambda key: key),
    )

    keys = [f"cache-eviction-test-key-{i}" for i in range(65)]
    clients = [openrouter_module.get_openrouter_client(key) for key in keys]

    assert len(created) == 65
    assert created[0].closed is True

    same_instance = openrouter_module.get_openrouter_client(keys[-1])
    assert same_instance is clients[-1]


def test_close_closes_shared_http_transport(monkeypatch) -> None:
    """`close()` must shut down the transport that carries ALL traffic.

    The OpenAI SDK client must share the same httpx.Client as raw HTTP calls —
    if the SDK built its own internal client, `close()` would miss it and the
    pool carrying chat/chat_stream traffic (the main traffic) would still leak
    on cache eviction. Constructs a real client (no network I/O happens at
    construction) and verifies both that the transport is shared and that
    `close()` actually closes it.
    """
    monkeypatch.setattr(openrouter_module, "get_settings", lambda: _StubSettings())

    client = OpenRouterClient("close-test-key")

    # The SDK's underlying httpx client is the very same object as `_http`.
    assert client._client._client is client._http

    # Sharing must not shrink chat/chat_stream timeouts: without an explicit
    # timeout the SDK inherits `_http`'s flat 60s, a silent 10x cut from the
    # SDK default 600s that long reasoning-model responses rely on.
    sdk_timeout = client._client.timeout
    assert isinstance(sdk_timeout, openrouter_module.httpx.Timeout)
    assert sdk_timeout.read == 600.0
    assert sdk_timeout.connect == 5.0

    client.close()

    assert client._http.is_closed
