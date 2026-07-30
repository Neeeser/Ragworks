"""The OpenAI Responses dialect.

Responses is where OpenAI's reasoning models expose reasoning summaries, so it
is the default for OpenAI connections. It reaches the same `ChatProvider`
contract as every other dialect: the run loop hands it Chat Completions-shaped
history and gets `ParsedChatResponse` / `ParsedStreamChunk` back, with the
vocabulary translation confined to `responses_translation`.

Streaming is the substantive difference. Responses emits named semantic events
rather than deltas on a choice, so tool calls arrive as an `output_item.added`
announcing the call followed by `function_call_arguments.delta` fragments. Both
are re-emitted here in the shared tool-call shape keyed by `output_index`,
which is what the stream accumulator merges on — a call announced without its
index would merge into whichever call happened to be at position zero.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, ClassVar

from app.clients.openai_compat import OpenAICompatClient, ResponsesCall
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.providers.chat.dialects import responses_translation as tr
from app.providers.chat.dialects.chat_completions import DIALECT_FLOOR_CAPABILITIES
from app.schemas.models import ModelInfo
from app.schemas.openai_responses import (
    REASONING_DELTA_EVENTS,
    TERMINAL_EVENTS,
    TEXT_DELTA_EVENT,
    ResponsesResponse,
    ResponsesStreamEvent,
)
from app.services.errors import ExternalServiceError

#: Parameters the Responses wire format accepts, spelled in the *canonical*
#: chat-parameter vocabulary (`max_tokens`): supported-parameter filtering
#: runs against these names before the wire call, so listing the wire
#: spelling (`max_output_tokens`) would filter the canonical key out and the
#: alias rename below would never see it. It drops several Chat Completions
#: knobs outright (`frequency_penalty`, `presence_penalty`, `logit_bias`,
#: `seed`, `stop`), so declaring the Chat Completions set here would offer
#: users parameters that 400.
#: Capability claims are deliberately absent — they are not knobs, and a
#: floor cannot state them (see `DIALECT_FLOOR_CAPABILITIES`).
RESPONSES_PARAMETERS: tuple[str, ...] = (
    "temperature",
    "top_p",
    "max_tokens",
    "top_logprobs",
    "response_format",
)

#: Chat Completions names that mean something different on Responses.
_PARAMETER_ALIASES = {"max_tokens": "max_output_tokens"}


class ResponsesProvider:
    """Chat provider over the OpenAI Responses API."""

    supported_parameters: ClassVar[tuple[str, ...]] = RESPONSES_PARAMETERS

    def __init__(
        self,
        client: OpenAICompatClient,
        *,
        name: str,
        model_resolver: Callable[[str], ModelInfo | None] | None = None,
    ) -> None:
        """Bind the dialect to a client, a reported provider name, and a catalog."""
        self._client = client
        self.name = name
        self._model_resolver = model_resolver

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return model metadata, or the dialect's own defaults when unlisted.

        Same split as the Chat Completions dialect: an authoritative catalog
        reports an unknown id as unknown; a server with none falls back to what
        the wire format accepts.
        """
        if self._model_resolver is not None:
            return self._model_resolver(model_id)
        return ModelInfo(
            id=model_id,
            name=model_id,
            supported_parameters=list(self.supported_parameters),
            capabilities=DIALECT_FLOOR_CAPABILITIES,
        )

    @staticmethod
    def _parameters(request: ChatRequest) -> dict[str, Any] | None:
        """Rename Chat Completions parameter keys onto their Responses spelling.

        `response_format` moves under `text.format`, flattening the nested
        `json_schema` envelope the Chat Completions shape wraps around the
        schema — `responses.create` has no `response_format` kwarg at all, so
        passing it through unrenamed is a `TypeError` before the request
        leaves the process.
        """
        if not request.parameters:
            return None
        parameters = {
            _PARAMETER_ALIASES.get(key, key): value
            for key, value in request.parameters.items()
        }
        response_format = parameters.pop("response_format", None)
        if isinstance(response_format, dict):
            schema_envelope = response_format.get("json_schema")
            if response_format.get("type") == "json_schema" and isinstance(
                schema_envelope, dict
            ):
                parameters["text"] = {
                    "format": {"type": "json_schema", **schema_envelope}
                }
            else:
                parameters["text"] = {"format": response_format}
        return parameters

    @staticmethod
    def _reasoning(request: ChatRequest) -> dict[str, Any] | None:
        """Map normalized reasoning options onto the Responses `reasoning` block.

        `summary: "auto"` is requested whenever reasoning is on: without it the
        API returns reasoning items with no readable content, so the UI shows a
        reasoning step that never says anything.
        """
        options = request.reasoning_options or {}
        reasoning = options.get("reasoning")
        if not isinstance(reasoning, dict):
            return None
        if reasoning.get("exclude") is True or reasoning.get("enabled") is False:
            return None
        block: dict[str, Any] = {"summary": "auto"}
        effort = reasoning.get("effort")
        if effort:
            block["effort"] = effort
        return block

    def _call(self, request: ChatRequest) -> ResponsesCall:
        """Map the normalized request onto a Responses invocation."""
        return ResponsesCall(
            input=tr.messages_to_input(request.messages),
            model=request.model,
            tools=tr.tools_to_responses(request.tools),
            parallel_tool_calls=True if request.tools else None,
            reasoning=self._reasoning(request),
            parameters=self._parameters(request),
            extra_body=request.extra_body or None,
        )

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Send a buffered Responses request."""
        return self._client.create_response(self._call(request)).model_dump(
            exclude_none=True
        )

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Stream a Responses request, dumping each typed event to a dict."""
        for event in self._client.stream_response(self._call(request)):
            yield event.model_dump(exclude_none=True)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a finished Responses payload into the shared parsed shape.

        A `failed` response carries its reason in `error`, not in output —
        parsing it as a message hands the user an empty answer with no
        explanation, so it surfaces as the provider failure it is.
        """
        parsed = ResponsesResponse.model_validate(response)
        if parsed.status == "failed":
            raise ExternalServiceError(
                tr.response_error_text(parsed) or "OpenAI reported the response failed."
            )
        return ParsedChatResponse(
            message=tr.response_to_message(parsed),
            usage=tr.usage_to_chat_shape(parsed.usage),
            provider=self.name,
            response_model=parsed.model,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize one Responses stream event into a delta snapshot."""
        if not isinstance(chunk, dict) or not chunk.get("type"):
            return None
        event = ResponsesStreamEvent.model_validate(chunk)
        if event.type == TEXT_DELTA_EVENT:
            return self._snapshot(delta_content=event.delta)
        if event.type in REASONING_DELTA_EVENTS:
            return self._snapshot(reasoning=event.delta)
        if event.type == "response.output_item.added":
            return self._tool_call_started(event)
        if event.type == "response.function_call_arguments.delta":
            return self._tool_call_arguments(event)
        if event.type == "error":
            # A mid-stream failure arrives as its own event and the SDK does
            # not raise for it (its check is a top-level `error` key, which
            # this frame has no room for). Left unhandled the stream simply
            # ends, and the run loop finalizes the truncated partial as a
            # complete answer with no usage — a failed turn stored, and
            # reported, as a successful one.
            raise ExternalServiceError(
                event.message or "OpenAI reported a stream error."
            )
        if event.type in TERMINAL_EVENTS:
            return self._terminal(event)
        return None

    def _snapshot(
        self,
        *,
        delta_content: Any = None,
        reasoning: Any = None,
        tool_calls: list[dict[str, Any]] | None = None,
        finish_reason: str | None = None,
        usage: dict[str, Any] | None = None,
        response_model: str | None = None,
    ) -> ParsedStreamChunk:
        """Build a delta snapshot with this provider's identity filled in."""
        return ParsedStreamChunk(
            provider=self.name,
            response_model=response_model,
            finish_reason=finish_reason,
            delta_content=delta_content,
            tool_calls=tool_calls,
            reasoning=reasoning,
            usage=usage,
        )

    def _tool_call_started(self, event: ResponsesStreamEvent) -> ParsedStreamChunk | None:
        """Emit the opening fragment of a tool call announced by the stream."""
        item = event.item
        if item is None or item.type != "function_call":
            return None
        return self._snapshot(
            tool_calls=[
                {
                    "index": event.output_index or 0,
                    "id": item.call_id or item.id or "",
                    "type": "function",
                    "function": {
                        "name": item.name or "",
                        "arguments": tr.encode_arguments(item.arguments)
                        if item.arguments
                        else "",
                    },
                }
            ]
        )

    def _tool_call_arguments(self, event: ResponsesStreamEvent) -> ParsedStreamChunk | None:
        """Emit an argument fragment for an in-flight tool call."""
        if event.delta is None:
            return None
        return self._snapshot(
            tool_calls=[
                {
                    "index": event.output_index or 0,
                    "function": {"arguments": event.delta},
                }
            ]
        )

    def _terminal(self, event: ResponsesStreamEvent) -> ParsedStreamChunk:
        """Emit the closing snapshot carrying finish reason and usage.

        A `response.failed` raises instead: the run loop persists whatever
        streamed and the route emits an error event with the provider's own
        message — a bare `finish_reason` would end the turn looking complete.
        """
        response = event.response
        finish_reason = "stop"
        if event.type == "response.failed":
            message = (
                tr.response_error_text(response) if response is not None else None
            )
            raise ExternalServiceError(
                message or "OpenAI reported the response failed."
            )
        if event.type == "response.incomplete":
            finish_reason = "length"
        elif response is not None and any(
            item.type == "function_call" for item in response.output
        ):
            finish_reason = "tool_calls"
        return self._snapshot(
            finish_reason=finish_reason,
            usage=tr.usage_to_chat_shape(response.usage) if response else None,
            response_model=response.model if response else None,
        )
