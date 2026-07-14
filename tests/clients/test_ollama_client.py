"""Behavior tests for OllamaClient against a mocked HTTP transport."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.clients.ollama import OllamaApiError, OllamaClient

TAGS_PAYLOAD: dict[str, Any] = {
    "models": [
        {
            "name": "llama3.2:latest",
            "model": "llama3.2:latest",
            "size": 2019393189,
            "digest": "a80c4f17acd5",
            "details": {
                "family": "llama",
                "parameter_size": "3.2B",
                "quantization_level": "Q4_K_M",
            },
        },
        {
            "name": "nomic-embed-text:latest",
            "model": "nomic-embed-text:latest",
            "size": 274302450,
            "digest": "0a109f422b47",
            "details": {"family": "nomic-bert", "parameter_size": "137M"},
        },
    ]
}

SHOW_PAYLOADS: dict[str, dict[str, Any]] = {
    "llama3.2:latest": {
        "capabilities": ["completion", "tools"],
        "details": {"parameter_size": "3.2B", "quantization_level": "Q4_K_M"},
        "model_info": {
            "general.architecture": "llama",
            "llama.context_length": 131072,
            "llama.embedding_length": 3072,
        },
    },
    "nomic-embed-text:latest": {
        "capabilities": ["embedding"],
        "details": {"parameter_size": "137M", "quantization_level": "F16"},
        "model_info": {
            "general.architecture": "nomic-bert",
            "nomic-bert.context_length": 2048,
            "nomic-bert.embedding_length": 768,
        },
    },
}


def _build_client(handler: httpx.MockTransport) -> OllamaClient:
    client = OllamaClient("http://ollama.test:11434", api_key="proxy-token")
    client._http = httpx.Client(
        base_url="http://ollama.test:11434",
        headers={"Authorization": "Bearer proxy-token"},
        transport=handler,
    )
    return client


def _catalog_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/tags":
        return httpx.Response(200, json=TAGS_PAYLOAD)
    if request.url.path == "/api/show":
        model = json.loads(request.content)["model"]
        return httpx.Response(200, json=SHOW_PAYLOADS[model])
    if request.url.path == "/api/version":
        return httpx.Response(200, json={"version": "0.9.2"})
    raise AssertionError(f"Unexpected path {request.url.path}")


def test_describe_models_classifies_capabilities_and_dimensions() -> None:
    client = _build_client(httpx.MockTransport(_catalog_handler))
    described = client.describe_models()

    by_name = {model.name: model for model in described}
    chat = by_name["llama3.2:latest"]
    assert chat.capabilities == ["completion", "tools"]
    assert chat.context_length == 131072
    embed = by_name["nomic-embed-text:latest"]
    assert embed.capabilities == ["embedding"]
    assert embed.embedding_dimension == 768


def test_describe_models_skips_a_model_whose_show_fails() -> None:
    """One broken model must not hide the rest of the server's catalog.

    Real case: a gpt-oss pull on an outdated Ollama build fails /api/show with
    'tensor "blk.0.ffn_down_exps.weight" size overflow' — the other models are
    still perfectly usable.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json=TAGS_PAYLOAD)
        if request.url.path == "/api/show":
            model = json.loads(request.content)["model"]
            if model == "llama3.2:latest":
                return httpx.Response(
                    500, json={"error": 'tensor "blk.0.ffn_down_exps.weight" size overflow'}
                )
            return httpx.Response(200, json=SHOW_PAYLOADS[model])
        raise AssertionError(f"Unexpected path {request.url.path}")

    client = _build_client(httpx.MockTransport(handler))
    described = client.describe_models()

    assert [model.name for model in described] == ["nomic-embed-text:latest"]
    assert described[0].capabilities == ["embedding"]


def test_version_sends_bearer_header() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("Authorization", "")
        return httpx.Response(200, json={"version": "0.9.2"})

    client = _build_client(httpx.MockTransport(handler))
    assert client.version() == "0.9.2"
    assert seen["authorization"] == "Bearer proxy-token"


def test_embed_batches_and_parses_vectors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["model"] == "nomic-embed-text"
        assert body["input"] == ["alpha", "beta"]
        assert "dimensions" not in body
        return httpx.Response(
            200,
            json={
                "model": "nomic-embed-text",
                "embeddings": [[0.1, 0.2], [0.3, 0.4]],
                "prompt_eval_count": 4,
            },
        )

    client = _build_client(httpx.MockTransport(handler))
    response = client.embed(["alpha", "beta"], model="nomic-embed-text")
    assert response.embeddings == [[0.1, 0.2], [0.3, 0.4]]
    assert response.prompt_eval_count == 4


def test_embed_error_status_raises_with_provider_message() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": 'model "missing" not found'})

    client = _build_client(httpx.MockTransport(handler))
    with pytest.raises(OllamaApiError, match='model "missing" not found'):
        client.embed(["alpha"], model="missing")


def test_chat_stream_parses_ndjson_chunks() -> None:
    lines = [
        {"model": "llama3.2", "message": {"role": "assistant", "content": "Hel"}, "done": False},
        {
            "model": "llama3.2",
            "message": {"role": "assistant", "content": "lo", "thinking": "hmm"},
            "done": False,
        },
        {
            "model": "llama3.2",
            "message": {"role": "assistant", "content": ""},
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 12,
            "eval_count": 5,
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["stream"] is True
        assert body["think"] is True
        content = "\n".join(json.dumps(line) for line in lines)
        return httpx.Response(200, text=content + "\n")

    client = _build_client(httpx.MockTransport(handler))
    chunks = list(
        client.chat_stream(
            [{"role": "user", "content": "Hi"}], model="llama3.2", think=True
        )
    )
    assert [c.message.content for c in chunks if c.message] == ["Hel", "lo", ""]
    assert chunks[1].message is not None
    assert chunks[1].message.thinking == "hmm"
    assert chunks[-1].done is True
    assert chunks[-1].prompt_eval_count == 12


def test_chat_stream_raises_on_inband_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=json.dumps({"error": "out of memory"}) + "\n")

    client = _build_client(httpx.MockTransport(handler))
    with pytest.raises(OllamaApiError, match="out of memory"):
        list(client.chat_stream([{"role": "user", "content": "Hi"}], model="llama3.2"))


def test_chat_parses_tool_calls() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["tools"][0]["function"]["name"] == "search"
        return httpx.Response(
            200,
            json={
                "model": "llama3.2",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "search", "arguments": {"query": "cats"}}}
                    ],
                },
                "done": True,
                "done_reason": "stop",
            },
        )

    client = _build_client(httpx.MockTransport(handler))
    response = client.chat(
        [{"role": "user", "content": "find cats"}],
        model="llama3.2",
        tools=[{"type": "function", "function": {"name": "search", "parameters": {}}}],
    )
    assert response.message is not None
    assert response.message.tool_calls is not None
    assert response.message.tool_calls[0].function.name == "search"
    assert response.message.tool_calls[0].function.arguments == {"query": "cats"}
