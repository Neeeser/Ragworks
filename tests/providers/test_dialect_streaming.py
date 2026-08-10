"""Stream-event parsing for the Responses and Messages dialects.

Both formats announce a tool call in one event and stream its arguments in
later ones. The chat subsystem's accumulator merges those fragments **by
index**, so the index each dialect chooses is the contract these tests pin: get
it wrong and two concurrent tool calls collapse into one corrupt call, which
looks like a model failure rather than a parsing bug.
"""

from __future__ import annotations

from typing import Any

from app.chat.tool_calls import accumulate_stream_tool_calls
from app.providers.chat.dialects import MessagesProvider, ResponsesProvider


def _drain(provider: Any, events: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Feed events through a provider and return the accumulated tool calls."""
    accumulator: dict[int, dict[str, Any]] = {}
    for event in events:
        parsed = provider.parse_stream_chunk(event)
        if parsed is not None and parsed.tool_calls:
            accumulate_stream_tool_calls(accumulator, parsed.tool_calls)
    return accumulator


class TestResponsesStreaming:
    """OpenAI Responses emits named semantic events, not deltas on a choice."""

    def test_text_and_reasoning_deltas_are_separated(self) -> None:
        provider = ResponsesProvider(client=None, name="openai")  # type: ignore[arg-type]

        text = provider.parse_stream_chunk({"type": "response.output_text.delta", "delta": "Hi"})
        reasoning = provider.parse_stream_chunk(
            {"type": "response.reasoning_summary_text.delta", "delta": "Thinking"}
        )

        assert text is not None
        assert text.delta_content == "Hi"
        assert text.reasoning is None
        assert reasoning is not None
        assert reasoning.reasoning == "Thinking"
        assert reasoning.delta_content is None

    def test_parallel_tool_calls_stay_distinct_by_output_index(self) -> None:
        """Two calls announced at different output indexes must not merge."""
        provider = ResponsesProvider(client=None, name="openai")  # type: ignore[arg-type]

        calls = _drain(
            provider,
            [
                {
                    "type": "response.output_item.added",
                    "output_index": 0,
                    "item": {"type": "function_call", "call_id": "call-a", "name": "search"},
                },
                {
                    "type": "response.output_item.added",
                    "output_index": 1,
                    "item": {"type": "function_call", "call_id": "call-b", "name": "count"},
                },
                {
                    "type": "response.function_call_arguments.delta",
                    "output_index": 0,
                    "delta": '{"q":',
                },
                {
                    "type": "response.function_call_arguments.delta",
                    "output_index": 1,
                    "delta": '{"n":',
                },
                {
                    "type": "response.function_call_arguments.delta",
                    "output_index": 0,
                    "delta": '"docs"}',
                },
                {
                    "type": "response.function_call_arguments.delta",
                    "output_index": 1,
                    "delta": "2}",
                },
            ],
        )

        assert calls[0]["id"] == "call-a"
        assert calls[0]["function"] == {"name": "search", "arguments": '{"q":"docs"}'}
        assert calls[1]["id"] == "call-b"
        assert calls[1]["function"] == {"name": "count", "arguments": '{"n":2}'}

    def test_terminal_event_reports_tool_calls_and_usage(self) -> None:
        provider = ResponsesProvider(client=None, name="openai")  # type: ignore[arg-type]

        parsed = provider.parse_stream_chunk(
            {
                "type": "response.completed",
                "response": {
                    "model": "gpt-test",
                    "output": [{"type": "function_call", "call_id": "c", "name": "search"}],
                    "usage": {"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
                },
            }
        )

        assert parsed is not None
        assert parsed.finish_reason == "tool_calls"
        assert parsed.response_model == "gpt-test"
        assert parsed.usage == {
            "prompt_tokens": 8,
            "completion_tokens": 3,
            "total_tokens": 11,
        }

    def test_unhandled_event_types_are_ignored(self) -> None:
        """An event this app does not consume must not break the turn."""
        provider = ResponsesProvider(client=None, name="openai")  # type: ignore[arg-type]

        assert provider.parse_stream_chunk({"type": "response.web_search_call.searching"}) is None
        assert provider.parse_stream_chunk({}) is None
        assert provider.parse_stream_chunk("bad") is None  # type: ignore[arg-type]


class TestMessagesStreaming:
    """Anthropic streams tool arguments as `input_json_delta` fragments."""

    def test_text_and_thinking_deltas_are_separated(self) -> None:
        provider = MessagesProvider(client=None)  # type: ignore[arg-type]

        text = provider.parse_stream_chunk(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hi"},
            }
        )
        thinking = provider.parse_stream_chunk(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "Reasoning"},
            }
        )

        assert text is not None
        assert text.delta_content == "Hi"
        assert thinking is not None
        assert thinking.reasoning == "Reasoning"

    def test_parallel_tool_calls_stay_distinct_by_block_index(self) -> None:
        provider = MessagesProvider(client=None)  # type: ignore[arg-type]

        calls = _drain(
            provider,
            [
                {
                    "type": "content_block_start",
                    "index": 1,
                    "content_block": {"type": "tool_use", "id": "toolu_a", "name": "search"},
                },
                {
                    "type": "content_block_start",
                    "index": 2,
                    "content_block": {"type": "tool_use", "id": "toolu_b", "name": "count"},
                },
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "input_json_delta", "partial_json": '{"q":'},
                },
                {
                    "type": "content_block_delta",
                    "index": 2,
                    "delta": {"type": "input_json_delta", "partial_json": '{"n":2}'},
                },
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "input_json_delta", "partial_json": '"docs"}'},
                },
            ],
        )

        assert calls[1]["id"] == "toolu_a"
        assert calls[1]["function"] == {"name": "search", "arguments": '{"q":"docs"}'}
        assert calls[2]["id"] == "toolu_b"
        assert calls[2]["function"] == {"name": "count", "arguments": '{"n":2}'}

    def test_a_text_block_start_announces_no_tool_call(self) -> None:
        provider = MessagesProvider(client=None)  # type: ignore[arg-type]

        parsed = provider.parse_stream_chunk(
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            }
        )

        assert parsed is None

    def test_message_delta_maps_the_stop_reason_and_reports_usage(self) -> None:
        provider = MessagesProvider(client=None)  # type: ignore[arg-type]

        parsed = provider.parse_stream_chunk(
            {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use"},
                "usage": {"input_tokens": 5, "output_tokens": 2},
            }
        )

        assert parsed is not None
        assert parsed.finish_reason == "tool_calls"
        assert parsed.usage == {
            "prompt_tokens": 5,
            "completion_tokens": 2,
            "total_tokens": 7,
        }
