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
from app.providers.registry import ProviderResolver
from app.providers.throttle import (
    RetryOutcome,
    call_with_retries,
    connection_slot,
)
from app.services.errors import InvalidInputError, is_external_provider_error

logger = logging.getLogger(__name__)

#: Tool name used when structured output is forced through a tool call.
STRUCTURED_TOOL_NAME = "emit_structured_output"

ValuesT = TypeVar("ValuesT")


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
        prompts: list[tuple[str, str]],
        schema: dict[str, Any],
        validate: Callable[[dict[str, Any]], ValuesT],
    ) -> list[LlmCallOutcome[ValuesT]]:
        """Run one structured call per (system, user) prompt pair, bounded.

        Order is preserved; `validate` turns each parsed payload into the
        node's typed values (raising `LlmOutputError` on shape misses, which
        follow the same failure policy as provider faults). In strict mode
        the first exhausted failure raises; otherwise failed calls return
        `values=None` outcomes with the error recorded on the engine's
        warnings.
        """
        if not prompts:
            return []
        if len(prompts) == 1:
            return [self._one_call(prompts[0], schema, validate)]
        workers = max(1, min(self._concurrency, len(prompts)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(lambda pair: self._one_call(pair, schema, validate), prompts))

    def _one_call(
        self,
        prompt_pair: tuple[str, str],
        schema: dict[str, Any],
        validate: Callable[[dict[str, Any]], ValuesT],
    ) -> LlmCallOutcome[ValuesT]:
        """One throttled, retried, validated structured call."""
        outcome = RetryOutcome()
        try:
            with connection_slot(self._connection_id, self._concurrency, rpm=self._rpm):
                payload, usage = call_with_retries(
                    lambda: self._request(prompt_pair, schema), outcome=outcome
                )
            values = validate(payload)
        except Exception as exc:
            if self.strict or not _is_degradable(exc):
                raise
            message = f"{self._node_label}: LLM call failed after retries — {exc}"
            logger.warning("%s", message)
            self.warnings.append(message)
            return LlmCallOutcome(values=None, retries=outcome.retries, error=str(exc))
        return LlmCallOutcome(values=values, usage=usage, retries=outcome.retries)

    def _request(
        self, prompt_pair: tuple[str, str], schema: dict[str, Any]
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Send one chat request and parse its structured payload."""
        system_prompt, user_prompt = prompt_pair
        messages: list[dict[str, Any]] = []
        system_text = system_prompt.strip()
        if self.mechanism == "instructed":
            instruction = (
                "Respond with a single JSON object matching this JSON schema, "
                f"and nothing else:\n{json.dumps(schema)}"
            )
            system_text = f"{system_text}\n\n{instruction}" if system_text else instruction
        if system_text:
            messages.append({"role": "system", "content": system_text})
        messages.append({"role": "user", "content": user_prompt})

        parameters: dict[str, Any] = {"temperature": self._config.temperature}
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
    raise LlmOutputError("Model response carried no content.")


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
