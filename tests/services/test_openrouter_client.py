from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

import pytest

from app.schemas.models import EndpointsListResponse, ListEndpointsResponse, ModelInfo
from app.services import openrouter as openrouter_module
from app.services.openrouter import OpenRouterClient


@dataclass
class _StubSettings:
    openrouter_api_key: str = "test-key"
    openrouter_base_url: str = "https://example.com/api/v1"
    openrouter_site_name: str = "TransparentRag"
    openrouter_site_url: str = "https://transparentrag.ai"
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
    responses: dict[str, list[dict[str, Any]]] = {}

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
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.embeddings = _StubEmbeddings()
        self.chat = _StubChat()


@pytest.fixture
def _client(monkeypatch) -> OpenRouterClient:
    _StubHttpClient.responses = {}
    monkeypatch.setattr(openrouter_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(openrouter_module.httpx, "Client", _StubHttpClient)
    monkeypatch.setattr(openrouter_module, "OpenAI", _StubOpenAI)
    return OpenRouterClient("test-key")


def test_list_models_caches_and_refreshes(_client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {"data": [{"id": "model-a", "name": "Model A"}]},
            {"data": [{"id": "model-b", "name": "Model B"}]},
        ]
    }

    first = _client.list_models()
    second = _client.list_models()
    refreshed = _client.list_models(force_refresh=True)

    assert [model.id for model in first] == ["model-a"]
    assert [model.id for model in second] == ["model-a"]
    assert [model.id for model in refreshed] == ["model-b"]
    assert _client._http.get_calls.count("/models") == 2


def test_get_model_refreshes_when_missing(_client: OpenRouterClient) -> None:
    _StubHttpClient.responses = {
        "/models": [
            {"data": []},
            {"data": [{"id": "provider/model", "canonical_slug": "provider/model", "name": "Model"}]},
        ]
    }

    model = _client.get_model("provider/model")

    assert isinstance(model, ModelInfo)
    assert model.id == "provider/model"
    assert _client._http.get_calls.count("/models") == 2


def test_get_model_returns_none_for_empty_id(_client: OpenRouterClient) -> None:
    assert _client.get_model("") is None


def test_get_model_matches_case_insensitive(_client: OpenRouterClient) -> None:
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

    model = _client.get_model("openai/gpt-4")

    assert model
    assert model.id == "OpenAI/GPT-4"


def test_get_model_matches_canonical_slug_case_insensitive(_client: OpenRouterClient) -> None:
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

    model = _client.get_model("OPENAI/GPT-4")

    assert model
    assert model.id == "OpenAI/GPT-4"


def test_list_model_endpoints_encodes_path(_client: OpenRouterClient) -> None:
    response = EndpointsListResponse(data=ListEndpointsResponse(id="model", name="Model"))
    _StubHttpClient.responses = {
        "/models/open%20ai/gpt%2F4/endpoints": [response.model_dump()],
    }

    payload = _client.list_model_endpoints("open ai", "gpt/4")

    assert payload.data.id == "model"
    assert _client._http.get_calls == ["/models/open%20ai/gpt%2F4/endpoints"]


def test_embed_merges_extra_headers(_client: OpenRouterClient) -> None:
    result = _client.embed(["hello"], extra_headers={"X-Extra": "value"})

    call = _client._client.embeddings.calls[0]
    assert call["extra_headers"]["X-Extra"] == "value"
    assert call["extra_headers"]["X-Title"] == "TransparentRag"
    assert result["data"][0]["embedding"] == [0.1]


def test_chat_includes_parameters_and_extra_body(_client: OpenRouterClient) -> None:
    payload = _client.chat(
        messages=[{"role": "user", "content": "hi"}],
        extra_body={"usage": {"include": True}},
        parameters={"temperature": 0.2, "top_p": None},
    )

    call = _client._client.chat.completions.calls[0]
    assert call["temperature"] == 0.2
    assert "top_p" not in call
    assert call["extra_body"] == {"usage": {"include": True}}
    assert payload["id"] == "chat-1"


def test_chat_includes_tool_settings(_client: OpenRouterClient) -> None:
    _client.chat(
        messages=[{"role": "user", "content": "hi"}],
        tools=[{"type": "function", "function": {"name": "tool"}}],
        tool_choice={"type": "function", "function": {"name": "tool"}},
        parallel_tool_calls=True,
    )

    call = _client._client.chat.completions.calls[0]
    assert call["tools"]
    assert call["tool_choice"]["function"]["name"] == "tool"
    assert call["parallel_tool_calls"] is True


def test_chat_stream_yields_chunks(_client: OpenRouterClient) -> None:
    chunks = list(
        _client.chat_stream(messages=[{"role": "user", "content": "hi"}], parameters={"top_p": 0.9})
    )

    call = _client._client.chat.completions.calls[0]
    assert call["stream"] is True
    assert call["top_p"] == 0.9
    assert chunks == [{"chunk": 1}, {"chunk": 2}]


def test_chat_stream_skips_none_parameters(_client: OpenRouterClient) -> None:
    list(
        _client.chat_stream(
            messages=[{"role": "user", "content": "hi"}],
            parameters={"top_p": None, "temperature": 0.1},
        )
    )

    call = _client._client.chat.completions.calls[0]
    assert call["temperature"] == 0.1
    assert "top_p" not in call


def test_build_app_headers_skips_referer(monkeypatch) -> None:
    @dataclass
    class _NoRefererSettings:
        openrouter_api_key: str = "test-key"
        openrouter_base_url: str = "https://example.com/api/v1"
        openrouter_site_name: str = "TransparentRag"
        openrouter_site_url: str | None = None
        default_embedding_model: str = "test-embed"
        default_chat_model: str = "test-chat"

    _StubHttpClient.responses = {}
    monkeypatch.setattr(openrouter_module, "get_settings", lambda: _NoRefererSettings())
    monkeypatch.setattr(openrouter_module.httpx, "Client", _StubHttpClient)
    monkeypatch.setattr(openrouter_module, "OpenAI", _StubOpenAI)

    client = OpenRouterClient("test-key")

    assert "HTTP-Referer" not in client._app_headers


def test_chat_stream_includes_tool_settings(_client: OpenRouterClient) -> None:
    chunks = list(
        _client.chat_stream(
            messages=[{"role": "user", "content": "hi"}],
            tools=[{"type": "function", "function": {"name": "tool"}}],
            tool_choice={"type": "function", "function": {"name": "tool"}},
            parallel_tool_calls=True,
            extra_body={"usage": {"include": True}},
        )
    )

    call = _client._client.chat.completions.calls[0]
    assert call["tools"]
    assert call["tool_choice"]["function"]["name"] == "tool"
    assert call["parallel_tool_calls"] is True
    assert call["extra_body"] == {"usage": {"include": True}}
    assert chunks == [{"chunk": 1}, {"chunk": 2}]
