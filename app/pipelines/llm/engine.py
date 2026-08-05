"""The LLM call engine every `llm.*` node runs through.

One place owns provider resolution, structured-output enforcement, bounded
concurrency, retries, the failure policy, and token accounting — the node
shells only declare ports and hand their rendered prompts here.

Failure policy is classified by run kind: an ingestion run is strict (a
corpus where some chunks silently lack their transformation is an invisible
quality bug), while a query-time run degrades per item with a recorded
warning (a live answer beats an error; the trace tells the truth).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar
from uuid import UUID

from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.output_schema import (
    LlmOutputError,
    parse_payload,
)
from app.pipelines.tracing.summaries import TokenUsage, combine_usage
from app.providers.chat.base import ChatProvider, ChatRequest
from app.providers.chat.content import user_content
from app.providers.registry import ProviderResolver
from app.providers.throttle import (
    RetryOutcome,
    RetryPolicy,
    call_with_retries,
    connection_slot,
)
from app.schemas.media import InlineMedia
from app.services.errors import InvalidInputError, is_external_provider_error

logger = logging.getLogger(__name__)

#: Tool name used when structured output is forced through a tool call.
STRUCTURED_TOOL_NAME = "emit_structured_output"

#: Output-shape failures (truncated JSON, a missing field, an out-of-range
#: index) are not congestion — there is nothing to back off from, and the
#: point is to catch a one-off bad generation, not to wait out a provider.
#: Kept deliberately small and separate from the transport `RetryPolicy`
#: (see `call_with_retries`'s `retryable` parameter): merging the two would
#: retry a genuine 429 twice as long as configured, or apply backoff to a
#: failure with nothing to back off from.
_OUTPUT_SHAPE_RETRY_POLICY = RetryPolicy(attempts=2, base_delay=0.0, max_delay=0.0)

ValuesT = TypeVar("ValuesT")


@dataclass(frozen=True)
class LlmCall:
    """One structured call: its rendered prompts and any attached media.

    Attachments travel with the call rather than inside the rendered user
    prompt because they are not text — a shell that describes an image
    hands the bytes here and the engine encodes them onto the request in
    the one place that knows the wire format.
    """

    system: str
    user: str
    images: tuple[InlineMedia, ...] = ()


@dataclass
class LlmCallOutcome(Generic[ValuesT]):
    """What one structured call produced (or why it failed, when degrading)."""

    values: ValuesT | None
    usage: TokenUsage = field(default_factory=TokenUsage)
    retries: int = 0
    error: str | None = None


class LlmEngine:
    """Runs a node's structured LLM calls against one connection + model."""

    def __init__(
        self,
        providers: ProviderResolver,
        config: LlmNodeConfig,
        *,
        node_label: str,
        strict: bool,
    ) -> None:
        """Resolve the chat provider and pin this call set's failure policy.

        `strict` follows the run kind — ingestion runs pass True, query-time
        runs False; the studio test bench passes True so a failure surfaces
        as itself rather than a degraded empty outcome.
        """
        if config.connection_id is None or not config.model_name:
            raise InvalidInputError(
                f"{node_label} needs a provider connection and model. "
                "Pick them in the pipeline editor."
            )
        self._connection_id: UUID = config.connection_id
        self._config = config
        self._node_label = node_label
        self._provider: ChatProvider = providers.chat(config.connection_id)
        self._concurrency = providers.request_concurrency(config.connection_id)
        self._rpm = providers.request_rpm(config.connection_id)
        #: Resolved once by the resolver at run construction (see
        #: `ProviderResolver.__init__`), never re-read per call.
        self._retry_policy: RetryPolicy = providers.retry_policy
        #: Ingestion runs are strict; query-time runs degrade with warnings.
        self.strict: bool = strict
        self.warnings: list[str] = []
        self.mechanism: str = self._pick_mechanism()

    def _pick_mechanism(self) -> str:
        """Choose how the output shape is forced, from the model's own claims.

        `response_format` when the model advertises it — and for unknown
        models, matching the permissive dialect floor (the provider's own
        rejection names the field). A model that only advertises tools gets a
        forced tool call carrying the same schema. Neither claim present
        falls back to instructing JSON and parsing tolerantly — the safety
        net, never the contract.
        """
        info = self._provider.get_model(self._config.model_name)
        if info is None or "response_format" in info.supported_parameters:
            return "response_format"
        if info.capabilities.tools:
            return "tool_call"
        return "instructed"

    def run_calls(
        self,
        calls: list[LlmCall],
        schema: dict[str, Any],
        validate: Callable[[dict[str, Any]], ValuesT],
    ) -> list[LlmCallOutcome[ValuesT]]:
        """Run one structured call per `LlmCall`, bounded by the connection.

        Order is preserved; `validate` turns each parsed payload into the
        node's typed values (raising `LlmOutputError` on shape misses, which
        follow the same failure policy as provider faults). In strict mode
        the first exhausted failure raises; otherwise failed calls return
        `values=None` outcomes with the error recorded on the engine's
        warnings.
        """
        if not calls:
            return []
        if len(calls) == 1:
            return [self._one_call(calls[0], schema, validate)]
        workers = max(1, min(self._concurrency, len(calls)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(lambda call: self._one_call(call, schema, validate), calls))

    def _one_call(
        self,
        call: LlmCall,
        schema: dict[str, Any],
        validate: Callable[[dict[str, Any]], ValuesT],
    ) -> LlmCallOutcome[ValuesT]:
        """One throttled, retried, validated structured call.

        Two retry layers, deliberately not merged (see
        `_OUTPUT_SHAPE_RETRY_POLICY`): the transport policy retries
        `_request` alone, with backoff, on provider faults; the output-shape
        policy retries the whole request-and-validate pair, without backoff,
        on `LlmOutputError` — which is why `validate` now runs *inside* the
        retry rather than after it, and why a schema miss re-issues the
        request rather than re-validating the same bad payload.
        """
        transport_outcome = RetryOutcome()
        shape_outcome = RetryOutcome()

        def attempt() -> tuple[ValuesT, TokenUsage]:
            payload, usage = call_with_retries(
                lambda: self._request(call, schema),
                policy=self._retry_policy,
                outcome=transport_outcome,
            )
            return validate(payload), usage

        try:
            with connection_slot(self._connection_id, self._concurrency, rpm=self._rpm):
                values, usage = call_with_retries(
                    attempt,
                    policy=_OUTPUT_SHAPE_RETRY_POLICY,
                    retryable=_is_output_shape_error,
                    outcome=shape_outcome,
                )
        except Exception as exc:
            if self.strict or not _is_degradable(exc):
                raise
            retries = transport_outcome.retries + shape_outcome.retries
            message = _failure_message(self._node_label, exc, retries)
            logger.warning("%s", message)
            self.warnings.append(message)
            return LlmCallOutcome(values=None, retries=retries, error=str(exc))
        return LlmCallOutcome(
            values=values,
            usage=usage,
            retries=transport_outcome.retries + shape_outcome.retries,
        )

    def _request(self, call: LlmCall, schema: dict[str, Any]) -> tuple[dict[str, Any], TokenUsage]:
        """Send one chat request and parse its structured payload."""
        messages: list[dict[str, Any]] = []
        system_text = call.system.strip()
        if self.mechanism == "instructed":
            instruction = (
                "Respond with a single JSON object matching this JSON schema, "
                f"and nothing else:\n{json.dumps(schema)}"
            )
            system_text = f"{system_text}\n\n{instruction}" if system_text else instruction
        if system_text:
            messages.append({"role": "system", "content": system_text})
        messages.append({"role": "user", "content": user_content(call.user, call.images)})

        parameters: dict[str, Any] = {"temperature": self._config.temperature}
        if self._config.max_output_tokens is not None:
            # `max_tokens` is the canonical chat-parameter spelling every
            # dialect reads (Ollama renames it to `num_predict`, Anthropic
            # clamps it to the model's ceiling). A wire spelling here would be
            # dropped in silence and the declared budget would bound nothing —
            # which is worse than no budget, because the chunk-window check
            # trusts it.
            parameters["max_tokens"] = self._config.max_output_tokens
        tools: list[dict[str, Any]] | None = None
        if self.mechanism == "response_format":
            parameters["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "structured_output",
                    "strict": True,
                    "schema": schema,
                },
            }
        elif self.mechanism == "tool_call":
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": STRUCTURED_TOOL_NAME,
                        "description": "Emit the structured output.",
                        "parameters": schema,
                    },
                }
            ]
            parameters["tool_choice"] = {
                "type": "function",
                "function": {"name": STRUCTURED_TOOL_NAME},
            }

        request = ChatRequest(
            messages=messages,
            tools=tools,
            model=self._config.model_name,
            parameters=parameters,
        )
        parsed = self._provider.parse_chat_response(self._provider.chat(request))
        usage = _token_usage(parsed.usage)
        return _extract_payload(parsed.message), usage

    def combined_usage(self, outcomes: list[LlmCallOutcome[ValuesT]]) -> TokenUsage:
        """Sum usage over this run's calls."""
        return combine_usage([outcome.usage for outcome in outcomes])


def _is_degradable(exc: Exception) -> bool:
    """Failures worth degrading over: provider faults and output shape misses.

    A bug in our own code (KeyError, AttributeError) must surface as itself
    even at query time — degrading over it hides the defect forever.
    """
    return is_external_provider_error(exc) or isinstance(exc, LlmOutputError)


def _is_output_shape_error(exc: Exception) -> bool:
    """The predicate for the output-shape retry layer — never provider faults.

    Kept separate from `is_retryable` (`app.providers.throttle`) on purpose:
    that predicate is for transport callers and must never learn about a
    pipeline-engine-specific error type, and this one must never start
    matching provider exceptions — the two failure classes stay independent.
    """
    return isinstance(exc, LlmOutputError)


def _failure_message(node_label: str, exc: Exception, retries: int) -> str:
    """Describe what actually happened — zero retries is not "after retries"."""
    if retries == 0:
        return f"{node_label}: LLM call failed — {exc}"
    if retries == 1:
        return f"{node_label}: LLM call failed after 1 retry — {exc}"
    return f"{node_label}: LLM call failed after {retries} retries — {exc}"


def _extract_payload(message: dict[str, Any]) -> dict[str, Any]:
    """Read the structured payload from a response message.

    A forced tool call answers in `tool_calls[].function.arguments`; content
    answers (response_format / instructed) parse the message text.
    """
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        arguments = (
            tool_calls[0].get("function", {}).get("arguments")
            if isinstance(tool_calls[0], dict)
            else None
        )
        if isinstance(arguments, str):
            return parse_payload(arguments)
        if isinstance(arguments, dict):
            return arguments
        raise LlmOutputError("Tool call carried no parseable arguments.")
    content = message.get("content")
    if isinstance(content, str):
        return parse_payload(content)
    if isinstance(content, list):
        text = "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
        return parse_payload(text)
    # Empty rather than malformed: on a reasoning model, hidden thinking
    # tokens can consume the entire max_output_tokens budget before any
    # answer text is produced, which looks identical to this from here —
    # the completion simply carries no `content` at all. Naming the same
    # field a truncated-JSON failure names is the actionable fix in both
    # cases, not a guess: an empty response has no other common cause worth
    # naming instead.
    raise LlmOutputError(
        "Model response carried no content — if this model exposes "
        "reasoning/thinking tokens, they may have used the entire "
        "max_output_tokens budget before producing an answer. Raise "
        "max_output_tokens."
    )


def _token_usage(usage: dict[str, Any]) -> TokenUsage:
    """Map a provider usage payload onto the pipeline's token accounting."""
    prompt = usage.get("prompt_tokens")
    total = usage.get("total_tokens")
    if total is None:
        completion = usage.get("completion_tokens")
        if isinstance(prompt, int) and isinstance(completion, int):
            total = prompt + completion
    return TokenUsage(
        prompt_tokens=prompt if isinstance(prompt, int) else None,
        total_tokens=total if isinstance(total, int) else None,
    )
