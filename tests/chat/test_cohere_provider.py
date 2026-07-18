"""Behavior tests for Cohere's chat adapter."""

from __future__ import annotations

from typing import Any

from app.cache import CacheSnapshot
from app.clients.cohere.schemas import CohereModel, CohereStreamEvent
from app.providers.chat.base import ChatRequest
from app.providers.chat.cohere import CohereChatProvider, convert_messages_to_cohere


def _request(**overrides: Any) -> ChatRequest:
    """Build a normalized chat request with optional overrides."""
    values: dict[str, Any] = {
        "messages": [{"role": "user", "content": "find weather"}],
        "tools": [{"type": "function", "function": {"name": "weather", "parameters": {}}}],
        "model": "command-a",
        "parameters": {
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 64,
            "stop": ["END"],
        },
    }
    values.update(overrides)
    return ChatRequest(**values)


def test_chat_maps_openai_tools_parameters_and_message_content() -> None:
    """Cohere receives its v2 request fields rather than OpenAI aliases."""
    class Client:
        def __init__(self) -> None:
            self.kwargs: dict[str, Any] = {}

        def chat(self, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
            self.kwargs = {"messages": messages, **kwargs}
            return {"message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}}

    client = Client()
    CohereChatProvider(client).chat(_request())

    assert client.kwargs["parameters"] == {
        "temperature": 0.2,
        "p": 0.7,
        "max_tokens": 64,
        "stop_sequences": ["END"],
    }
    assert "stop" not in client.kwargs["parameters"]
    assert client.kwargs["tools"] == [{"type": "function", "function": {"name": "weather", "parameters": {}}}]
    assert client.kwargs["messages"] == [{"role": "user", "content": "find weather"}]


def test_message_conversion_preserves_tool_history_and_text_blocks() -> None:
    """Tool transcripts become Cohere documents while assistant calls remain linked."""
    tool_calls = [
        {
            "id": "call-1",
            "type": "function",
            "function": {"name": "weather", "arguments": "{}"},
        }
    ]

    converted = convert_messages_to_cohere(
        [
            {"role": "user", "content": [{"type": "text", "text": "weather"}]},
            {"role": "assistant", "content": None, "tool_calls": tool_calls},
            {"role": "tool", "tool_call_id": "call-1", "content": {"temp": 72}},
        ]
    )

    assert converted == [
        {"role": "user", "content": "weather"},
        {"role": "assistant", "content": "", "tool_calls": tool_calls},
        {
            "role": "tool",
            "tool_call_id": "call-1",
            "content": [{"type": "document", "document": {"data": "{'temp': 72}"}}],
        },
    ]


def test_chat_omits_empty_parameter_envelopes() -> None:
    """A request without sampler controls does not send an empty Cohere parameter map."""

    class Client:
        def chat(self, _messages: list[dict[str, Any]], **kwargs: Any) -> Any:
            assert kwargs["parameters"] is None
            return {"message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}}

    response = CohereChatProvider(Client()).chat(_request(parameters=None))  # type: ignore[arg-type]

    assert response["message"]["content"][0]["text"] == "ok"


def test_get_model_matches_case_insensitively_and_returns_none_when_absent() -> None:
    """Chat model lookup exposes catalog capabilities only for matching models."""

    class Client:
        @staticmethod
        def list_models(_endpoint: str) -> CacheSnapshot[list[CohereModel]]:
            return CacheSnapshot(
                value=[CohereModel(name="Command-A", description="chat", context_length=8192)],
                freshness="fresh",
                age_seconds=0,
                refreshing=False,
                warning=None,
            )

    provider = CohereChatProvider(Client())  # type: ignore[arg-type]
    model = provider.get_model("command-a")

    assert model is not None
    assert model.context_length == 8192
    assert "tools" in model.supported_parameters
    assert provider.get_model("missing") is None


def test_chat_stream_forwards_sparse_cohere_events() -> None:
    """Stream forwarding retains provider event fields while omitting absent fields."""

    class Client:
        @staticmethod
        def chat_stream(*_args: object, **_kwargs: object) -> list[CohereStreamEvent]:
            return [
                CohereStreamEvent.model_validate(
                    {
                        "type": "content-delta",
                        "model": "command-a",
                        "delta": {"message": {"content": [{"type": "text", "text": "hi"}]}},
                    }
                )
            ]

    events = list(CohereChatProvider(Client()).chat_stream(_request()))  # type: ignore[arg-type]

    assert events == [
        {
            "type": "content-delta",
            "delta": {"message": {"content": [{"type": "text", "text": "hi"}]}},
            "model": "command-a",
        }
    ]


def test_parse_chat_response_normalizes_text_tool_calls_and_usage() -> None:
    """Cohere content blocks normalize to the shared OpenAI-shaped message."""
    parsed = CohereChatProvider(object()).parse_chat_response(
        {
            "model": "command-a",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "I'll check."}],
                "tool_calls": [
                    {
                        "id": "weather-1",
                        "type": "function",
                        "function": {"name": "weather", "arguments": '{"city":"Boston"}'},
                    }
                ],
            },
            "usage": {"tokens": {"input_tokens": 12, "output_tokens": 8}},
        }
    )

    assert parsed.provider == "cohere"
    assert parsed.response_model == "command-a"
    assert parsed.message["content"] == "I'll check."
    assert parsed.message["tool_calls"][0]["function"]["name"] == "weather"
    assert parsed.usage == {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20}


def test_parse_chat_response_keeps_reasoning_and_billed_usage_without_tool_calls() -> None:
    """A planning-only response preserves its reasoning and normalizes billed units."""
    parsed = CohereChatProvider(object()).parse_chat_response(
        {
            "message": {"tool_plan": "I need to check the forecast."},
            "usage": {"billed_units": {"input_tokens": 4, "output_tokens": 3}},
        }
    )

    assert parsed.message == {
        "role": "assistant",
        "content": "",
        "reasoning": "I need to check the forecast.",
    }
    assert parsed.usage == {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7}


def test_parse_stream_chunk_normalizes_tool_start_and_argument_delta() -> None:
    """Cohere tool-call SSE frames preserve indices, ids, names, and fragments."""
    provider = CohereChatProvider(object())
    started = provider.parse_stream_chunk(
        {
            "type": "tool-call-start",
            "index": 1,
            "delta": {
                "message": {
                    "tool_calls": {
                        "id": "call-2",
                        "type": "function",
                        "function": {"name": "weather", "arguments": ""},
                    }
                }
            },
        }
    )
    delta = provider.parse_stream_chunk(
        {
            "type": "tool-call-delta",
            "index": 1,
            "delta": {"message": {"tool_calls": {"function": {"arguments": '{"city"'}}}},
        }
    )
    named_delta = provider.parse_stream_chunk(
        {
            "type": "tool-call-delta",
            "index": 1,
            "delta": {
                "message": {
                    "tool_calls": {
                        "function": {"name": "weather", "arguments": "\":\"Boston\"}"}
                    }
                }
            },
        }
    )

    assert started is not None
    assert started.tool_calls is not None
    assert started.tool_calls == [
        {"index": 1, "id": "call-2", "type": "function", "function": {"name": "weather", "arguments": ""}}
    ]
    assert delta is not None
    assert delta.tool_calls is not None
    assert delta.tool_calls == [{"index": 1, "function": {"arguments": '{"city"'}}]
    assert named_delta is not None
    assert named_delta.tool_calls == [
        {"index": 1, "function": {"name": "weather", "arguments": "\":\"Boston\"}"}}
    ]


def test_parse_stream_chunk_preserves_content_usage_and_ignores_unknown_events() -> None:
    """Only supported SSE events become client deltas, including their terminal usage."""
    provider = CohereChatProvider(object())

    content = provider.parse_stream_chunk(
        {
            "type": "content-delta",
            "model": "command-a",
            "delta": {"message": {"content": [{"type": "text", "text": "hello"}]}},
        }
    )
    completed = provider.parse_stream_chunk(
        {
            "type": "message-end",
            "delta": {
                "finish_reason": "COMPLETE",
                "usage": {"tokens": {"input_tokens": 3, "output_tokens": 2}},
            },
        }
    )
    ignored = provider.parse_stream_chunk({"type": "ping", "delta": {}})

    assert content is not None
    assert content.delta_content == "hello"
    assert completed is not None
    assert completed.finish_reason == "COMPLETE"
    assert completed.usage == {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}
    assert ignored is None
