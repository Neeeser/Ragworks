"""The vocabulary translations each non-Chat-Completions dialect owns.

These run at the lowest layer that can be wrong: pure functions over the exact
message shapes the chat subsystem persists. A translation bug here surfaces as
a tool call that never runs or a usage record that reads as zero, both of which
are invisible from a route-level test.
"""

from __future__ import annotations

import json

from app.providers.chat.dialects import messages_translation as anthropic_tr
from app.providers.chat.dialects import responses_translation as openai_tr
from app.schemas.anthropic import MessagesResponse, MessagesUsage
from app.schemas.openai_responses import ResponsesResponse, ResponsesUsage

TOOL_CALL_ID = "call-1"

HISTORY = [
    {"role": "system", "content": "Be brief."},
    {"role": "user", "content": "Search the docs."},
    {
        "role": "assistant",
        "content": "Looking it up.",
        "tool_calls": [
            {
                "id": TOOL_CALL_ID,
                "type": "function",
                "function": {"name": "search", "arguments": '{"query": "docs"}'},
            }
        ],
    },
    {"role": "tool", "tool_call_id": TOOL_CALL_ID, "content": "Found 3 results."},
]

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": "Search the collection",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
        },
    }
]


class TestResponsesTranslation:
    """Chat Completions history ↔ the Responses `input` list."""

    def test_tool_call_and_result_stay_paired_by_call_id(self) -> None:
        """Responses matches a call to its output by `call_id`, not position."""
        items = openai_tr.messages_to_input(HISTORY)

        call = next(item for item in items if item.get("type") == "function_call")
        output = next(item for item in items if item.get("type") == "function_call_output")
        assert call["call_id"] == output["call_id"] == TOOL_CALL_ID
        assert call["name"] == "search"
        assert output["output"] == "Found 3 results."

    def test_tool_call_without_an_id_is_dropped(self) -> None:
        """An unpaired call would make the next request fail validation."""
        items = openai_tr.messages_to_input(
            [
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{"function": {"name": "search", "arguments": "{}"}}],
                }
            ]
        )

        assert items == []

    def test_tools_flatten_out_of_the_function_wrapper(self) -> None:
        converted = openai_tr.tools_to_responses(TOOLS)

        assert converted == [
            {
                "type": "function",
                "name": "search",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
                "description": "Search the collection",
            }
        ]

    def test_usage_is_renamed_onto_the_shared_vocabulary(self) -> None:
        """Usage is compared across providers, so the key names must match."""
        shaped = openai_tr.usage_to_chat_shape(
            ResponsesUsage(input_tokens=10, output_tokens=4, total_tokens=14)
        )

        assert shaped == {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}

    def test_output_items_become_one_chat_completions_message(self) -> None:
        response = ResponsesResponse.model_validate(
            {
                "model": "gpt-test",
                "output": [
                    {"type": "reasoning", "summary": [{"type": "summary_text", "text": "Think."}]},
                    {"type": "message", "content": [{"type": "output_text", "text": "Hello"}]},
                    {
                        "type": "function_call",
                        "call_id": TOOL_CALL_ID,
                        "name": "search",
                        "arguments": '{"query":"docs"}',
                    },
                ],
            }
        )

        message = openai_tr.response_to_message(response)

        assert message["content"] == "Hello"
        assert message["reasoning"] == "Think."
        assert message["tool_calls"][0]["id"] == TOOL_CALL_ID
        assert message["tool_calls"][0]["function"]["arguments"] == '{"query":"docs"}'


class TestMessagesTranslation:
    """Chat Completions history ↔ the Anthropic Messages shape."""

    def test_system_turns_are_hoisted_out_of_the_history(self) -> None:
        """Anthropic carries the system prompt top-level, not as a message."""
        system, rest = anthropic_tr.split_system(HISTORY)

        assert system == "Be brief."
        assert all(message["role"] != "system" for message in rest)

    def test_every_system_turn_is_kept(self) -> None:
        """A session accumulates several; keeping only the first drops instructions."""
        system, _ = anthropic_tr.split_system(
            [
                {"role": "system", "content": "Be brief."},
                {"role": "system", "content": "Cite sources."},
                {"role": "user", "content": "hi"},
            ]
        )

        assert system == "Be brief.\n\nCite sources."

    def test_tool_arguments_decode_from_json_string_to_object(self) -> None:
        """Anthropic's `tool_use.input` is an object; a JSON string is rejected."""
        _, history = anthropic_tr.split_system(HISTORY)
        converted = anthropic_tr.messages_to_anthropic(history)

        assistant = next(turn for turn in converted if turn["role"] == "assistant")
        tool_use = next(block for block in assistant["content"] if block["type"] == "tool_use")
        assert tool_use["input"] == {"query": "docs"}
        assert tool_use["id"] == TOOL_CALL_ID

    def test_tool_results_ride_a_user_turn(self) -> None:
        """There is no `tool` role — a result is a block on a user turn."""
        _, history = anthropic_tr.split_system(HISTORY)
        converted = anthropic_tr.messages_to_anthropic(history)

        result_turn = converted[-1]
        assert result_turn["role"] == "user"
        assert result_turn["content"][0]["type"] == "tool_result"
        assert result_turn["content"][0]["tool_use_id"] == TOOL_CALL_ID

    def test_an_empty_assistant_turn_is_dropped(self) -> None:
        """Anthropic rejects a message whose content list is empty."""
        converted = anthropic_tr.messages_to_anthropic(
            [{"role": "assistant", "content": ""}, {"role": "user", "content": "hi"}]
        )

        assert converted == [{"role": "user", "content": "hi"}]

    def test_tool_use_stop_reason_becomes_tool_calls(self) -> None:
        """The run loop branches on `tool_calls`; `tool_use` would end the turn."""
        assert anthropic_tr.map_stop_reason("tool_use") == "tool_calls"
        assert anthropic_tr.map_stop_reason("end_turn") == "stop"
        assert anthropic_tr.map_stop_reason("max_tokens") == "length"

    def test_usage_is_renamed_and_totalled(self) -> None:
        shaped = anthropic_tr.usage_to_chat_shape(MessagesUsage(input_tokens=12, output_tokens=5))

        assert shaped["prompt_tokens"] == 12
        assert shaped["completion_tokens"] == 5
        assert shaped["total_tokens"] == 17

    def test_content_blocks_become_one_chat_completions_message(self) -> None:
        response = MessagesResponse.model_validate(
            {
                "model": "claude-test",
                "content": [
                    {"type": "thinking", "thinking": "Reasoning."},
                    {"type": "text", "text": "Hello"},
                    {
                        "type": "tool_use",
                        "id": TOOL_CALL_ID,
                        "name": "search",
                        "input": {"query": "docs"},
                    },
                ],
                "stop_reason": "tool_use",
            }
        )

        message = anthropic_tr.response_to_message(response)

        assert message["content"] == "Hello"
        assert message["reasoning"] == "Reasoning."
        assert json.loads(message["tool_calls"][0]["function"]["arguments"]) == {"query": "docs"}
