"""The OpenAI Chat Completions dialect.

This is the wire format OpenAI, OpenRouter, vLLM, llama.cpp, LM Studio, and
every other OpenAI-compatible server speaks, implemented once. A provider that
speaks it supplies a client and a way to look up model metadata; it writes no
request shaping or response parsing of its own. Provider-specific extensions
ride `extra_body`, which is the one hook a subclass overrides — that is the
whole surface OpenRouter needs to add its routing and usage-accounting block.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, ClassVar

from pydantic import ValidationError

from app.clients.openai_compat import ChatCall, OpenAICompatClient
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.schemas.chat_completions import ChatCompletionChunk, ChatCompletionResponse
from app.schemas.models import ModelInfo

#: Sampling parameters the Chat Completions wire format accepts. Declared by
#: the dialect rather than per model: an OpenAI-compatible server publishes no
#: per-model parameter list, so what the format accepts is the only honest
#: answer. A model that rejects one returns its own error naming the parameter,
#: which beats a picker that hides a knob the model actually supports.
CHAT_COMPLETIONS_PARAMETERS: tuple[str, ...] = (
    "temperature",
    "top_p",
    "max_tokens",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "stop",
    "logit_bias",
    "logprobs",
    "top_logprobs",
    "response_format",
    "tools",
)

ModelResolver = Callable[[str], ModelInfo | None]


class ChatCompletionsProvider:
    """Chat provider over any endpoint speaking Chat Completions."""

    supported_parameters: ClassVar[tuple[str, ...]] = CHAT_COMPLETIONS_PARAMETERS

    def __init__(
        self,
        client: OpenAICompatClient,
        *,
        name: str,
        model_resolver: ModelResolver | None = None,
    ) -> None:
        """Bind the dialect to a client, a reported provider name, and a catalog."""
        self._client = client
        self.name = name
        self._model_resolver = model_resolver

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return model metadata, or the dialect's own defaults when unlisted.

        A provider that supplies a resolver has an authoritative catalog, so an
        id it does not know is a stale selection and must surface as one. A
        provider that supplies none (a server publishing bare ids) still needs
        a `ModelInfo`: without it every sampling parameter is filtered out as
        unsupported and the user's settings silently stop reaching the model.
        """
        if self._model_resolver is not None:
            return self._model_resolver(model_id)
        return ModelInfo(
            id=model_id,
            name=model_id,
            supported_parameters=list(self.supported_parameters),
        )

    def build_extra_body(self, request: ChatRequest) -> dict[str, Any] | None:
        """Return provider-specific body extensions; none for plain OpenAI."""
        del request
        return None

    def _call(self, request: ChatRequest) -> ChatCall:
        """Map the normalized request onto a client-level call."""
        return ChatCall(
            messages=request.messages,
            model=request.model,
            tools=request.tools,
            parallel_tool_calls=True if request.tools else None,
            extra_body=self.build_extra_body(request),
            parameters=request.parameters or None,
        )

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Send a buffered chat request."""
        return self._client.chat(self._call(request)).model_dump(exclude_none=True)

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Stream a chat request, dumping each typed chunk to a dict."""
        for chunk in self._client.chat_stream(self._call(request)):
            yield chunk.model_dump(exclude_none=True)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a buffered response into the shared parsed shape."""
        parsed = ChatCompletionResponse.model_validate(response)
        choice = parsed.choices[0] if parsed.choices else None
        message = (
            choice.message.model_dump(exclude_none=True)
            if choice is not None and choice.message
            else {}
        )
        usage = parsed.usage.model_dump(exclude_none=True) if parsed.usage else {}
        return ParsedChatResponse(
            message=message,
            usage=usage,
            provider=parsed.provider or self.name,
            response_model=parsed.model,
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming chunk into a delta snapshot.

        A chunk that validates is read through the typed model; one that fails
        falls back to lenient dict access. The two paths stay separate so
        neither leaks the other's shape — an OpenAI-compatible server that
        deviates on one field must not take the whole turn down.
        """
        if not isinstance(chunk, dict):
            return None
        try:
            parsed = ChatCompletionChunk.model_validate(chunk)
        except ValidationError:
            return self._parse_raw_stream_chunk(chunk)
        return self._parse_typed_stream_chunk(parsed)

    @staticmethod
    def _parse_typed_stream_chunk(parsed: ChatCompletionChunk) -> ParsedStreamChunk | None:
        """Extract a delta snapshot from a validated stream chunk."""
        if not parsed.choices:
            return None
        choice = parsed.choices[0]
        delta = choice.delta
        tool_calls = (
            [call.model_dump(exclude_none=True) for call in delta.tool_calls]
            if delta and delta.tool_calls
            else None
        )
        reasoning = None
        if delta is not None:
            reasoning = delta.reasoning if delta.reasoning else delta.reasoning_content
        return ParsedStreamChunk(
            provider=parsed.provider,
            response_model=parsed.model,
            finish_reason=choice.finish_reason,
            delta_content=delta.content if delta else None,
            tool_calls=tool_calls,
            reasoning=reasoning,
            usage=parsed.usage.model_dump(exclude_none=True) if parsed.usage else None,
        )

    @staticmethod
    def _parse_raw_stream_chunk(chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Extract a delta snapshot from a chunk that failed typed validation."""
        choices = chunk.get("choices") or []
        if not choices:
            return None
        choice = choices[0]
        delta = choice.get("delta") or {}
        return ParsedStreamChunk(
            provider=chunk.get("provider"),
            response_model=chunk.get("model"),
            finish_reason=choice.get("finish_reason"),
            delta_content=delta.get("content"),
            tool_calls=delta.get("tool_calls") or None,
            reasoning=delta.get("reasoning") or delta.get("reasoning_content"),
            usage=chunk.get("usage") or None,
        )
