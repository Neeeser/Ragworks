"""Behavior tests for Cohere's chat adapter."""

from __future__ import annotations

from typing import Any


def _request(**overrides: Any):
    """Build a normalized chat request with optional overrides."""
    from app.providers.chat.base import ChatRequest

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
    from app.providers.chat.cohere import CohereChatProvider

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


def test_parse_chat_response_normalizes_text_tool_calls_and_usage() -> None:
    """Cohere content blocks normalize to the shared OpenAI-shaped message."""
    from app.providers.chat.cohere import CohereChatProvider

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


def test_parse_stream_chunk_normalizes_tool_start_and_argument_delta() -> None:
    """Cohere tool-call SSE frames preserve indices, ids, names, and fragments."""
    from app.providers.chat.cohere import CohereChatProvider

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

    assert started is not None
    assert started.tool_calls is not None
    assert started.tool_calls == [
        {"index": 1, "id": "call-2", "type": "function", "function": {"name": "weather", "arguments": ""}}
    ]
    assert delta is not None
    assert delta.tool_calls is not None
    assert delta.tool_calls == [{"index": 1, "function": {"arguments": '{"city"'}}]
