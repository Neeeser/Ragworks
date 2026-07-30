"""Reasoning-override and OpenRouter-request shaping for chat requests.

The wire-level sanitization this module used to do by hand (`PARAMETER_TYPE_HINTS`
+ a pile of `coerce_*` functions) now lives as field validators on
`ChatParameters` / `ProviderPreferences` (`app/schemas/chat_parameters.py`).
What remains here is genuinely request-shaping, not wire coercion:
`sanitize_parameter_overrides` filters an already-typed `ChatParameters` down
to the specific model's supported parameters; `prepare_reasoning_override` and
`build_reasoning_options` construct the normalized reasoning options
(`build_openrouter_body` — the OpenRouter wire shaping — lives with the
provider in `app/providers/chat/openrouter.py`).
"""

from __future__ import annotations

from typing import Any

from app.schemas.chat_parameters import (
    ChatParameters,
    coerce_bool_parameter,
    coerce_numeric_parameter,
)
from app.schemas.models import ChatCapabilities, ReasoningStyle

#: Every effort level any provider accepts, across all of them: OpenAI adds
#: `none`/`minimal`/`xhigh`, Anthropic adds `xhigh`/`max`. This gate only
#: rejects nonsense — which levels a given model takes is published per model
#: in `ChatCapabilities.reasoning_efforts`, and dropping a level here would
#: silently discard a choice the model genuinely accepts.
REASONING_EFFORT_OPTIONS = {
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
}


def normalize_reasoning_effort(value: Any) -> str | None:
    """Normalize reasoning effort strings to allowed values."""
    if not value:
        return None
    lowered = value.strip().lower() if isinstance(value, str) else str(value).strip().lower()
    return lowered if lowered in REASONING_EFFORT_OPTIONS else None


def _apply_reasoning_override_key(prepared: dict[str, Any], key: Any, value: Any) -> None:
    """Coerce one raw reasoning-override key/value into `prepared` if valid."""
    normalized_key = str(key).lower()
    if normalized_key == "effort":
        effort_value = normalize_reasoning_effort(value)
        if effort_value:
            prepared["effort"] = effort_value
    elif normalized_key == "max_tokens":
        numeric_value = coerce_numeric_parameter(value)
        if numeric_value is not None:
            prepared["max_tokens"] = int(numeric_value)
    elif normalized_key in {"exclude", "enabled"}:
        bool_value = coerce_bool_parameter(value)
        if bool_value is not None:
            prepared[normalized_key] = bool_value


def prepare_reasoning_override(raw: Any) -> dict[str, Any] | None:
    """Prepare a reasoning override payload from raw input."""
    if raw is None:
        return None
    payload: dict[str, Any]
    if isinstance(raw, dict):
        payload = raw
    else:
        normalized = normalize_reasoning_effort(raw)
        if not normalized:
            return None
        payload = {"effort": normalized}
    prepared: dict[str, Any] = {}
    for key, value in payload.items():
        _apply_reasoning_override_key(prepared, key, value)
    return prepared or None


def sanitize_parameter_overrides(
    parameters: ChatParameters | None,
    supported_parameters: list[str] | None,
) -> dict[str, Any]:
    """Filter already-typed chat parameters down to a model's supported set.

    `parameters` has already been coerced/validated by `ChatParameters` at
    the wire boundary; this only re-keys the set fields to the exact casing
    OpenRouter advertises in `supported_parameters` and drops anything the
    selected model doesn't support.
    """
    if parameters is None or not supported_parameters:
        return {}
    supported_lookup = {param.lower(): param for param in supported_parameters}
    sanitized: dict[str, Any] = {}
    for key, value in parameters.model_dump(exclude_none=True).items():
        canonical_key = supported_lookup.get(key.lower())
        if canonical_key:
            sanitized[canonical_key] = value
    return sanitized


def build_reasoning_options(
    capabilities: ChatCapabilities,
    effort: str | None,
) -> dict[str, Any]:
    """Build the normalized reasoning options for the selected model.

    A model whose provider never claimed reasoning gets nothing: the block is
    a capability claim, and sending one to a model without it is a hard 400
    naming a field the user never set.

    An effort is included only when one was actually chosen. Defaulting to a
    level would both override the model's own default and, on OpenAI, switch
    reasoning on for a turn the user meant to sample with `temperature` —
    which that generation rejects while reasoning is active.
    """
    options: dict[str, Any] = {}
    if capabilities.reasoning is ReasoningStyle.NONE:
        return options
    if capabilities.reasoning is ReasoningStyle.INCLUDE_FLAG:
        options["include_reasoning"] = True
        return options
    block: dict[str, Any] = {}
    selected_effort = normalize_reasoning_effort(effort)
    if selected_effort:
        block["effort"] = selected_effort
    options["reasoning"] = block
    return options
