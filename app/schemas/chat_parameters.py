"""Wire-level chat request parameter models.

`ChatParameters` and `ProviderPreferences` are the typed replacements for the
raw `dict[str, Any]` that `ChatMessageCreate.parameters` / `.provider` used to
carry. Field validators reproduce the exact coercion behavior of the former
hand-rolled sanitizers in `app/chat/parameters.py`
(`PARAMETER_TYPE_HINTS` + the provider-preference coercers): a value that
can't be coerced to the field's type is dropped to `None` rather than
rejected with a 422, because these are optional user-supplied overrides, not
required input — the model itself is the "sanitizer" now.
"""

from __future__ import annotations

import json
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

VERBOSITY_OPTIONS = {"low", "medium", "high"}
PROVIDER_SORT_OPTIONS = {"price", "throughput", "latency"}
PROVIDER_DATA_COLLECTION_OPTIONS = {"allow", "deny"}

_CANONICAL_PROVIDER_KEYS = {
    "order",
    "allow_fallbacks",
    "require_parameters",
    "data_collection",
    "zdr",
    "enforce_distillable_text",
    "only",
    "ignore",
    "quantizations",
    "sort",
    "max_price",
}
_PROVIDER_KEY_ALIASES = {
    "allowfallbacks": "allow_fallbacks",
    "requireparameters": "require_parameters",
    "datacollection": "data_collection",
    "enforcedistillabletext": "enforce_distillable_text",
    "maxprice": "max_price",
}


def coerce_numeric_parameter(value: Any) -> float | None:
    """Coerce numeric parameter values into floats."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            number = float(stripped)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(number):
        return None
    return number


def coerce_bool_parameter(value: Any) -> bool | None:
    """Coerce parameter values into booleans when possible."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return None


def coerce_dict_parameter(value: Any) -> dict[str, Any] | None:
    """Coerce parameter values into dictionaries when possible."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return None
        if isinstance(decoded, dict):
            return decoded
    return None


def coerce_list_parameter(value: Any) -> list[str] | None:
    """Coerce parameter values into a list of strings, wrapping bare scalars."""
    if value is None:
        return None
    items: list[str] = []
    if isinstance(value, list):
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                text = item.strip()
                if text:
                    items.append(text)
            else:
                items.append(str(item))
    elif isinstance(value, str):
        normalized = value.replace("\n", ",")
        for piece in normalized.split(","):
            text = piece.strip()
            if text:
                items.append(text)
    else:
        items.append(str(value))
    return items or None


def coerce_string_list(value: Any) -> list[str] | None:
    """Normalize string lists from various input formats (no scalar wrapping)."""
    if value is None:
        return None
    items: list[str] = []
    if isinstance(value, str):
        chunks = value.replace("\n", ",").split(",")
        for chunk in chunks:
            trimmed = chunk.strip()
            if trimmed:
                items.append(trimmed)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            if item is None:
                continue
            trimmed = str(item).strip()
            if trimmed:
                items.append(trimmed)
    return items or None


def _coerce_int_parameter(value: Any) -> int | None:
    """Coerce integer parameter values from numeric input."""
    number = coerce_numeric_parameter(value)
    return None if number is None else int(number)


def _coerce_verbosity(value: Any) -> str | None:
    """Normalize verbosity values to the allowed enum options."""
    lowered = value.strip().lower() if isinstance(value, str) else str(value).strip().lower()
    return lowered if lowered in VERBOSITY_OPTIONS else None


def coerce_provider_sort(value: Any) -> str | None:
    """Validate provider sort options."""
    if value is None:
        return None
    candidate = str(value).strip().lower()
    return candidate if candidate in PROVIDER_SORT_OPTIONS else None


def coerce_data_collection(value: Any) -> str | None:
    """Validate provider data collection preferences."""
    if value is None:
        return None
    candidate = str(value).strip().lower()
    return candidate if candidate in PROVIDER_DATA_COLLECTION_OPTIONS else None


def coerce_max_price(value: Any) -> dict[str, float] | None:
    """Normalize max price configurations for providers."""
    if not isinstance(value, dict):
        return None
    parsed: dict[str, float] = {}
    for key in ("prompt", "completion", "request", "image"):
        if key not in value:
            continue
        number = coerce_numeric_parameter(value.get(key))
        if number is None:
            continue
        parsed[key] = float(number)
    return parsed or None


def _normalize_provider_key(key: str) -> str | None:
    """Normalize provider option keys (case/alias-insensitive) to canonical names."""
    normalized = key.strip().lower().replace("-", "_")
    if normalized in _CANONICAL_PROVIDER_KEYS:
        return normalized
    return _PROVIDER_KEY_ALIASES.get(normalized)


class ChatParameters(BaseModel):
    """User-supplied OpenRouter sampling parameter overrides.

    Every field mirrors an OpenRouter sampling parameter. Unknown keys in the
    incoming payload are ignored (a client sending a parameter this model
    doesn't know about is not an error); values that fail coercion become
    `None` and are dropped by the caller (`sanitize_parameter_overrides` in
    `app/chat/parameters.py`) rather than rejected.
    """

    model_config = ConfigDict(extra="ignore")

    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    min_p: float | None = None
    top_a: float | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    repetition_penalty: float | None = None
    max_tokens: int | None = None
    seed: int | None = None
    logit_bias: dict[str, Any] | None = None
    logprobs: bool | None = None
    top_logprobs: int | None = None
    response_format: dict[str, Any] | None = None
    structured_outputs: bool | None = None
    stop: list[str] | None = None
    verbosity: Literal["low", "medium", "high"] | None = None
    reasoning: dict[str, Any] | None = None

    @field_validator(
        "temperature",
        "top_p",
        "min_p",
        "top_a",
        "frequency_penalty",
        "presence_penalty",
        "repetition_penalty",
        mode="before",
    )
    @classmethod
    def _validate_float(cls, value: Any) -> float | None:
        return coerce_numeric_parameter(value)

    @field_validator("top_k", "max_tokens", "seed", "top_logprobs", mode="before")
    @classmethod
    def _validate_int(cls, value: Any) -> int | None:
        return _coerce_int_parameter(value)

    @field_validator("logit_bias", "response_format", "reasoning", mode="before")
    @classmethod
    def _validate_dict(cls, value: Any) -> dict[str, Any] | None:
        return coerce_dict_parameter(value)

    @field_validator("logprobs", "structured_outputs", mode="before")
    @classmethod
    def _validate_bool(cls, value: Any) -> bool | None:
        return coerce_bool_parameter(value)

    @field_validator("stop", mode="before")
    @classmethod
    def _validate_stop(cls, value: Any) -> list[str] | None:
        return coerce_list_parameter(value)

    @field_validator("verbosity", mode="before")
    @classmethod
    def _validate_verbosity(cls, value: Any) -> str | None:
        return _coerce_verbosity(value)


class ProviderPreferences(BaseModel):
    """User-supplied OpenRouter provider routing preferences.

    Incoming keys are normalized case-insensitively (and via a small set of
    known aliases, e.g. `allowFallbacks`) before validation; unrecognized
    keys are dropped rather than rejected.
    """

    model_config = ConfigDict(extra="ignore")

    order: list[str] | None = None
    allow_fallbacks: bool | None = None
    require_parameters: bool | None = None
    data_collection: Literal["allow", "deny"] | None = None
    zdr: bool | None = None
    enforce_distillable_text: bool | None = None
    only: list[str] | None = None
    ignore: list[str] | None = None
    quantizations: list[str] | None = None
    sort: Literal["price", "throughput", "latency"] | None = None
    max_price: dict[str, float] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_keys(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        normalized: dict[str, Any] = {}
        for key, value in data.items():
            if not isinstance(key, str):
                continue
            canonical = _normalize_provider_key(key)
            if canonical:
                normalized[canonical] = value
        return normalized

    @field_validator("order", "only", "ignore", "quantizations", mode="before")
    @classmethod
    def _validate_list(cls, value: Any) -> list[str] | None:
        return coerce_string_list(value)

    @field_validator(
        "allow_fallbacks",
        "require_parameters",
        "zdr",
        "enforce_distillable_text",
        mode="before",
    )
    @classmethod
    def _validate_bool(cls, value: Any) -> bool | None:
        return coerce_bool_parameter(value)

    @field_validator("sort", mode="before")
    @classmethod
    def _validate_sort(cls, value: Any) -> str | None:
        return coerce_provider_sort(value)

    @field_validator("data_collection", mode="before")
    @classmethod
    def _validate_data_collection(cls, value: Any) -> str | None:
        return coerce_data_collection(value)

    @field_validator("max_price", mode="before")
    @classmethod
    def _validate_max_price(cls, value: Any) -> dict[str, float] | None:
        return coerce_max_price(value)

    def to_request_payload(self) -> dict[str, Any] | None:
        """Return the OpenRouter `provider` request payload, or `None` if empty."""
        return self.model_dump(exclude_none=True) or None
