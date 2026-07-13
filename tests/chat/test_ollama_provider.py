"""Behavior tests for the Ollama chat provider's wire translations."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from app.providers.chat.base import ChatRequest
from app.providers.chat.ollama import (
    OllamaChatProvider,
    convert_messages_to_ollama,
    model_info_from_description,
)
from app.schemas.ollama import OllamaModelDescription

THINKING_TOOL_MODEL = OllamaModelDescription(
    name="qwen3:8b",
    capabilities=["completion", "tools", "thinking"],
    parameter_size="8.2B",
    quantization_level="Q4_K_M",
    context_length=40960,
)
PLAIN_MODEL = OllamaModelDescription(
    name="llama3.2:latest", capabilities=["completion"], context_length=131072
)


@dataclass
class _StubOllamaClient:
    descriptions: list[OllamaModelDescription] = field(default_factory=list)
    chat_calls: list[dict[str, Any]] = field(default_factory=list)

    def describe_models(self, force_refresh: bool = False) -> list[OllamaModelDescription]:
        return self.descriptions

    def chat(self, **kwargs: Any) -> Any:
        self.chat_calls.append(kwargs)
        from app.schemas.ollama import OllamaChatResponse

        return OllamaChatResponse.model_validate(
            {"model": kwargs["model"], "message": {"role": "assistant", "content": "ok"}, "done": True}
        )


def _request(**overrides: Any) -> ChatRequest:
    defaults: dict[str, Any] = {
        "messages": [{"role": "user", "content": "hi"}],
        "tools": None,
        "model": "qwen3:8b",
        "parameters": None,
    }
    defaults.update(overrides)
    return ChatRequest(**defaults)


def test_model_info_maps_capabilities_to_supported_parameters() -> None:
    info = model_info_from_description(THINKING_TOOL_MODEL)
    assert "tools" in info.supported_parameters
    assert "reasoning" in info.supported_parameters
    assert "temperature" in info.supported_parameters
    assert info.context_length == 40960

    plain = model_info_from_description(PLAIN_MODEL)
    assert "tools" not in plain.supported_parameters
    assert "reasoning" not in plain.supported_parameters


def test_convert_messages_resolves_tool_names_and_decodes_arguments() -> None:
    messages = [
        {"role": "system", "content": "be helpful"},
        {"role": "user", "content": [{"type": "text", "text": "find cats"}]},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "search", "arguments": '{"query": "cats"}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": '{"response": []}'},
    ]
    converted = convert_messages_to_ollama(messages)
    assert converted[1] == {"role": "user", "content": "find cats"}
    assert converted[2]["tool_calls"][0]["function"]["arguments"] == {"query": "cats"}
    assert converted[3] == {
        "role": "tool",
        "content": '{"response": []}',
        "tool_name": "search",
    }


def test_chat_maps_parameters_think_and_options() -> None:
    client = _StubOllamaClient(descriptions=[THINKING_TOOL_MODEL])
    provider = OllamaChatProvider(client)  # type: ignore[arg-type]

    provider.chat(
        _request(
            parameters={"temperature": 0.2, "max_tokens": 128, "repetition_penalty": 1.1},
            reasoning_options={"reasoning": {"effort": "high"}},
        )
    )
    call = client.chat_calls[0]
    assert call["options"] == {"temperature": 0.2, "num_predict": 128, "repeat_penalty": 1.1}
    assert call["think"] is True


def test_think_omitted_for_non_thinking_models_and_disabled_on_exclude() -> None:
    client = _StubOllamaClient(descriptions=[THINKING_TOOL_MODEL, PLAIN_MODEL])
    provider = OllamaChatProvider(client)  # type: ignore[arg-type]

    provider.chat(_request(model="llama3.2:latest", reasoning_options={"reasoning": {}}))
    assert client.chat_calls[-1]["think"] is None

    provider.chat(_request(reasoning_options={"reasoning": {"exclude": True}}))
    assert client.chat_calls[-1]["think"] is False


def test_parse_chat_response_normalizes_message_usage_and_tool_ids() -> None:
    client = _StubOllamaClient()
    provider = OllamaChatProvider(client)  # type: ignore[arg-type]
    parsed = provider.parse_chat_response(
        {
            "model": "qwen3:8b",
            "message": {
                "role": "assistant",
                "content": "",
                "thinking": "let me check",
                "tool_calls": [
                    {"function": {"name": "search", "arguments": {"query": "cats"}}}
                ],
            },
            "done": True,
            "prompt_eval_count": 10,
            "eval_count": 6,
        }
    )
    assert parsed.provider == "ollama"
    assert parsed.response_model == "qwen3:8b"
    assert parsed.message["reasoning"] == "let me check"
    call = parsed.message["tool_calls"][0]
    assert call["id"].startswith("tool_call_")
    assert json.loads(call["function"]["arguments"]) == {"query": "cats"}
    assert parsed.usage == {"prompt_tokens": 10, "completion_tokens": 6, "total_tokens": 16}


def test_stream_chunks_get_unique_tool_call_indexes() -> None:
    client = _StubOllamaClient()
    provider = OllamaChatProvider(client)  # type: ignore[arg-type]
    chunk = {
        "model": "qwen3:8b",
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "search", "arguments": {"q": "a"}}}],
        },
        "done": False,
    }
    first = provider.parse_stream_chunk(chunk)
    second = provider.parse_stream_chunk(chunk)
    assert first is not None
    assert first.tool_calls is not None
    assert second is not None
    assert second.tool_calls is not None
    assert first.tool_calls[0]["index"] != second.tool_calls[0]["index"]


def test_stream_final_chunk_carries_finish_reason_and_usage() -> None:
    client = _StubOllamaClient()
    provider = OllamaChatProvider(client)  # type: ignore[arg-type]
    parsed = provider.parse_stream_chunk(
        {
            "model": "qwen3:8b",
            "message": {"role": "assistant", "content": ""},
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 3,
            "eval_count": 2,
        }
    )
    assert parsed is not None
    assert parsed.finish_reason == "stop"
    assert parsed.usage == {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}
