"""The Anthropic Messages dialect.

Two things are model-dependent and are read from Anthropic's own live
capability catalog rather than a shipped table: which thinking mode a model
takes (`adaptive` on the 4.7-and-later generation, `enabled` with a token
budget before that), and whether it still accepts sampling parameters — the
same generation that gained adaptive thinking rejects `temperature`, `top_p`,
and `top_k` outright. Deriving both from `GET /v1/models` is what makes a model
released after this code was written work without an edit; a hardcoded list
would start 400-ing the moment Anthropic ships the next family.

Streaming carries tool calls as a `content_block_start` announcing a `tool_use`
block followed by `input_json_delta` fragments. Both are re-emitted in the
shared tool-call shape keyed by the block `index`, which is what the stream
accumulator merges on.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, ClassVar

from app.clients.anthropic import DEFAULT_MAX_TOKENS, AnthropicClient, MessagesCall
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.providers.chat.dialects import messages_translation as tr
from app.schemas.anthropic import (
    AnthropicModel,
    MessagesResponse,
    MessagesStreamEvent,
)
from app.schemas.models import ModelInfo

#: Parameters every Claude model accepts.
BASE_PARAMETERS: tuple[str, ...] = ("max_tokens", "stop", "tools", "reasoning")

#: Sampling parameters, offered only to models that still accept them.
SAMPLING_PARAMETERS: tuple[str, ...] = ("temperature", "top_p", "top_k")

#: Effort levels the Messages API accepts, in the app's own vocabulary.
_EFFORT_VALUES = frozenset({"low", "medium", "high"})

#: Share of a model's output ceiling given to thinking when a model needs an
#: explicit budget. Anthropic requires the budget to be strictly below
#: `max_tokens`; taking half leaves the answer room to finish after the model
#: has thought, instead of hitting the cap mid-sentence.
_THINKING_BUDGET_RATIO = 0.5
_MIN_THINKING_BUDGET = 1024


def model_info_from_catalog(model: AnthropicModel) -> ModelInfo:
    """Build the shared `ModelInfo` from Anthropic's published capabilities."""
    supported = list(BASE_PARAMETERS)
    if not model.capabilities.thinking.adaptive:
        supported.extend(SAMPLING_PARAMETERS)
    return ModelInfo(
        id=model.id,
        name=model.display_name or model.id,
        context_length=model.max_input_tokens,
        supported_parameters=supported,
    )


class MessagesProvider:
    """Chat provider over the Anthropic Messages API."""

    name = "anthropic"
    supported_parameters: ClassVar[tuple[str, ...]] = BASE_PARAMETERS

    def __init__(self, client: AnthropicClient) -> None:
        """Bind the dialect to an Anthropic client."""
        self._client = client

    def _catalog_entry(self, model_id: str) -> AnthropicModel | None:
        """Look up a model in the client's cached catalog."""
        return self._client.get_model(model_id)

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return model metadata from the live capability catalog."""
        entry = self._catalog_entry(model_id)
        if entry is None:
            return None
        return model_info_from_catalog(entry)

    @staticmethod
    def _max_tokens(request: ChatRequest, entry: AnthropicModel | None) -> int:
        """Resolve the required output cap for this call.

        A user-set value wins, clamped to the model's published ceiling so an
        over-large request is trimmed rather than 400-ing. With none set the
        default is a normal answer size — *not* the ceiling, which is a cap the
        SDK reads as "this turn may run for an hour" and refuses to send
        unbuffered.
        """
        ceiling = entry.max_tokens if entry is not None and entry.max_tokens else None
        requested = (request.parameters or {}).get("max_tokens")
        if isinstance(requested, int) and requested > 0:
            return min(requested, ceiling) if ceiling else requested
        return min(DEFAULT_MAX_TOKENS, ceiling) if ceiling else DEFAULT_MAX_TOKENS

    def _thinking(
        self, request: ChatRequest, entry: AnthropicModel | None, max_tokens: int
    ) -> dict[str, Any] | None:
        """Map normalized reasoning options onto the model's thinking mode."""
        options = request.reasoning_options or {}
        reasoning = options.get("reasoning")
        if not isinstance(reasoning, dict):
            return None
        if reasoning.get("exclude") is True or reasoning.get("enabled") is False:
            return None
        capability = entry.capabilities.thinking if entry else None
        if capability is None or not capability.supported:
            return None
        if capability.adaptive:
            return {"type": "adaptive", "display": "summarized"}
        budget = max(_MIN_THINKING_BUDGET, int(max_tokens * _THINKING_BUDGET_RATIO))
        if budget >= max_tokens:
            return None
        return {"type": "enabled", "budget_tokens": budget}

    @staticmethod
    def _effort(request: ChatRequest, entry: AnthropicModel | None) -> dict[str, Any] | None:
        """Map a reasoning effort onto `output_config.effort` where supported."""
        if entry is None or not entry.capabilities.effort.supported:
            return None
        reasoning = (request.reasoning_options or {}).get("reasoning")
        if not isinstance(reasoning, dict):
            return None
        effort = reasoning.get("effort")
        if isinstance(effort, str) and effort in _EFFORT_VALUES:
            return {"effort": effort}
        return None

    def _parameters(
        self, request: ChatRequest, entry: AnthropicModel | None
    ) -> dict[str, Any] | None:
        """Build the extra request parameters, dropping the ones this model rejects."""
        parameters = dict(request.parameters or {})
        parameters.pop("max_tokens", None)
        stop = parameters.pop("stop", None)
        if stop:
            parameters["stop_sequences"] = stop
        if entry is not None and entry.capabilities.thinking.adaptive:
            for name in SAMPLING_PARAMETERS:
                parameters.pop(name, None)
        effort = self._effort(request, entry)
        if effort is not None:
            parameters["output_config"] = effort
        return parameters or None

    def _call(self, request: ChatRequest) -> MessagesCall:
        """Map the normalized request onto a Messages invocation."""
        entry = self._catalog_entry(request.model)
        max_tokens = self._max_tokens(request, entry)
        system, history = tr.split_system(request.messages)
        return MessagesCall(
            messages=tr.messages_to_anthropic(history),
            model=request.model,
            max_tokens=max_tokens,
            system=system,
            tools=tr.tools_to_anthropic(request.tools),
            thinking=self._thinking(request, entry, max_tokens),
            parameters=self._parameters(request, entry),
            extra_body=request.extra_body or None,
        )

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Send a buffered Messages request."""
        return self._client.create_message(self._call(request)).model_dump(
            exclude_none=True
        )

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Stream a Messages request, dumping each typed event to a dict."""
        for event in self._client.stream_message(self._call(request)):
            yield event.model_dump(exclude_none=True)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a finished Messages payload into the shared parsed shape."""
        parsed = MessagesResponse.model_validate(response)
        return ParsedChatResponse(
            message=tr.response_to_message(parsed),
            usage=tr.usage_to_chat_shape(parsed.usage),
            provider=self.name,
            response_model=parsed.model,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize one Messages stream event into a delta snapshot."""
        if not isinstance(chunk, dict) or not chunk.get("type"):
            return None
        event = MessagesStreamEvent.model_validate(chunk)
        if event.type == "content_block_start":
            return self._block_started(event)
        if event.type == "content_block_delta":
            return self._block_delta(event)
        if event.type == "message_delta":
            return self._message_delta(event)
        if event.type == "message_start":
            return self._message_start(event)
        return None

    def _snapshot(self, **fields: Any) -> ParsedStreamChunk:
        """Build a delta snapshot with this provider's identity filled in."""
        return ParsedStreamChunk(
            provider=self.name,
            response_model=fields.get("response_model"),
            finish_reason=fields.get("finish_reason"),
            delta_content=fields.get("delta_content"),
            tool_calls=fields.get("tool_calls"),
            reasoning=fields.get("reasoning"),
            usage=fields.get("usage"),
        )

    def _message_start(self, event: MessagesStreamEvent) -> ParsedStreamChunk | None:
        """Emit the opening snapshot carrying the model and prompt-token count."""
        message = event.message
        if message is None:
            return None
        return self._snapshot(
            response_model=message.model,
            usage=tr.usage_to_chat_shape(message.usage) or None,
        )

    def _block_started(self, event: MessagesStreamEvent) -> ParsedStreamChunk | None:
        """Emit the opening fragment of a tool call announced by the stream."""
        block = event.content_block
        if block is None or block.type != "tool_use":
            return None
        return self._snapshot(
            tool_calls=[
                {
                    "index": event.index or 0,
                    "id": block.id or "",
                    "type": "function",
                    "function": {"name": block.name or "", "arguments": ""},
                }
            ]
        )

    def _block_delta(self, event: MessagesStreamEvent) -> ParsedStreamChunk | None:
        """Emit a text, reasoning, or tool-argument increment."""
        delta = event.delta
        if delta is None:
            return None
        if delta.type == "text_delta" and delta.text is not None:
            return self._snapshot(delta_content=delta.text)
        if delta.type == "thinking_delta" and delta.thinking is not None:
            return self._snapshot(reasoning=delta.thinking)
        if delta.type == "input_json_delta" and delta.partial_json is not None:
            return self._snapshot(
                tool_calls=[
                    {
                        "index": event.index or 0,
                        "function": {"arguments": delta.partial_json},
                    }
                ]
            )
        return None

    def _message_delta(self, event: MessagesStreamEvent) -> ParsedStreamChunk | None:
        """Emit the closing snapshot carrying stop reason and output tokens."""
        stop_reason = event.delta.stop_reason if event.delta else None
        return self._snapshot(
            finish_reason=tr.map_stop_reason(stop_reason),
            usage=tr.usage_to_chat_shape(event.usage) or None,
        )
