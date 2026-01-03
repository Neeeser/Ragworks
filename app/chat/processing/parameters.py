"""Parameter and provider preference normalization for chat requests."""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional


PARAMETER_TYPE_HINTS: Dict[str, str] = {
    "temperature": "float",
    "top_p": "float",
    "top_k": "int",
    "min_p": "float",
    "top_a": "float",
    "frequency_penalty": "float",
    "presence_penalty": "float",
    "repetition_penalty": "float",
    "max_tokens": "int",
    "seed": "int",
    "logit_bias": "dict",
    "logprobs": "bool",
    "top_logprobs": "int",
    "response_format": "dict",
    "structured_outputs": "bool",
    "stop": "list",
    "verbosity": "enum",
    "reasoning": "dict",
}
VERBOSITY_OPTIONS = {"low", "medium", "high"}
REASONING_EFFORT_OPTIONS = {"minimal", "low", "medium", "high"}
PROVIDER_ALLOWED_KEYS = {
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
PROVIDER_KEY_ALIASES = {
    "allowfallbacks": "allow_fallbacks",
    "allow-fallbacks": "allow_fallbacks",
    "requireparameters": "require_parameters",
    "require-parameters": "require_parameters",
    "datacollection": "data_collection",
    "data-collection": "data_collection",
    "enforcedistillabletext": "enforce_distillable_text",
    "enforce-distillable-text": "enforce_distillable_text",
    "maxprice": "max_price",
}
PROVIDER_SORT_OPTIONS = {"price", "throughput", "latency"}
PROVIDER_DATA_COLLECTION_OPTIONS = {"allow", "deny"}


def coerce_numeric_parameter(value: Any) -> Optional[float]:
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


def coerce_bool_parameter(value: Any) -> Optional[bool]:
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


def coerce_dict_parameter(value: Any) -> Optional[Dict[str, Any]]:
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


def coerce_list_parameter(value: Any) -> Optional[List[str]]:
    """Coerce parameter values into a list of strings."""
    if value is None:
        return None
    items: List[str] = []
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


def normalize_reasoning_effort(value: Any) -> Optional[str]:
    """Normalize reasoning effort strings to allowed values."""
    if not value:
        return None
    if isinstance(value, str):
        lowered = value.strip().lower()
    else:
        lowered = str(value).strip().lower()
    return lowered if lowered in REASONING_EFFORT_OPTIONS else None


def prepare_reasoning_override(raw: Any) -> Optional[Dict[str, Any]]:
    """Prepare a reasoning override payload from raw input."""
    if raw is None:
        return None
    payload: Dict[str, Any]
    if isinstance(raw, dict):
        payload = raw
    else:
        normalized = normalize_reasoning_effort(raw)
        if not normalized:
            return None
        payload = {"effort": normalized}
    prepared: Dict[str, Any] = {}
    for key, value in payload.items():
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
    return prepared or None


def coerce_parameter_value(key: str, value: Any) -> Optional[Any]:
    """Coerce parameter values based on declared type hints."""
    hint = PARAMETER_TYPE_HINTS.get(key)
    if hint is None:
        return None
    result: Optional[Any] = None
    if hint == "float":
        result = coerce_numeric_parameter(value)
    elif hint == "int":
        number = coerce_numeric_parameter(value)
        result = None if number is None else int(number)
    elif hint == "bool":
        result = coerce_bool_parameter(value)
    elif hint == "dict":
        result = coerce_dict_parameter(value)
    elif hint == "list":
        result = coerce_list_parameter(value)
    elif hint == "enum":
        if isinstance(value, str):
            lowered = value.strip().lower()
        else:
            lowered = str(value).strip().lower()
        result = lowered if lowered in VERBOSITY_OPTIONS else None
    return result


def sanitize_parameter_overrides(
    raw: Optional[Dict[str, Any]],
    supported_parameters: Optional[List[str]],
) -> Dict[str, Any]:
    """Validate and sanitize parameter overrides."""
    if not raw or not supported_parameters:
        return {}
    supported_lookup = {param.lower(): param for param in supported_parameters}
    sanitized: Dict[str, Any] = {}
    for incoming_key, value in raw.items():
        normalized_key = incoming_key.lower()
        canonical_key = supported_lookup.get(normalized_key)
        if not canonical_key or normalized_key not in PARAMETER_TYPE_HINTS:
            continue
        parsed = coerce_parameter_value(normalized_key, value)
        if parsed is None:
            continue
        sanitized[canonical_key] = parsed
    return sanitized


def build_reasoning_options(
    supported_parameters: Optional[List[str]],
    effort: Optional[str],
) -> Dict[str, Any]:
    """Build reasoning options compatible with the selected model."""
    selected_effort = normalize_reasoning_effort(effort) or "medium"
    options: Dict[str, Any] = {}

    if not supported_parameters:
        options["reasoning"] = {"effort": selected_effort}
        return options

    normalized = {param.lower() for param in supported_parameters}

    if "reasoning" in normalized:
        options["reasoning"] = {"effort": selected_effort}
    elif "include_reasoning" in normalized:
        options["include_reasoning"] = True
    else:
        options["reasoning"] = {"effort": selected_effort}

    return options


def build_openrouter_body(
    reasoning_options: Optional[Dict[str, Any]],
    provider_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the OpenRouter extra_body payload for chat requests."""
    body: Dict[str, Any] = dict(reasoning_options) if reasoning_options else {}
    usage_config = body.get("usage")
    if isinstance(usage_config, dict):
        merged_usage = dict(usage_config)
        merged_usage["include"] = True
        body["usage"] = merged_usage
    else:
        body["usage"] = {"include": True}
    if provider_options:
        body["provider"] = provider_options
    return body


def normalize_provider_key(key: str) -> Optional[str]:
    """Normalize provider option keys to accepted names."""
    normalized = key.strip().lower().replace("-", "_")
    if normalized in PROVIDER_ALLOWED_KEYS:
        return normalized
    return PROVIDER_KEY_ALIASES.get(normalized)


def coerce_string_list(value: Any) -> Optional[List[str]]:
    """Normalize string lists from various input formats."""
    if value is None:
        return None
    items: List[str] = []
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


def coerce_provider_sort(value: Any) -> Optional[str]:
    """Validate provider sort options."""
    if value is None:
        return None
    candidate = str(value).strip().lower()
    if candidate in PROVIDER_SORT_OPTIONS:
        return candidate
    return None


def coerce_data_collection(value: Any) -> Optional[str]:
    """Validate provider data collection preferences."""
    if value is None:
        return None
    candidate = str(value).strip().lower()
    if candidate in PROVIDER_DATA_COLLECTION_OPTIONS:
        return candidate
    return None


def coerce_max_price(value: Any) -> Optional[Dict[str, float]]:
    """Normalize max price configurations for providers."""
    if not isinstance(value, dict):
        return None
    parsed: Dict[str, float] = {}
    for key in ("prompt", "completion", "request", "image"):
        if key not in value:
            continue
        number = coerce_numeric_parameter(value.get(key))
        if number is None:
            continue
        parsed[key] = float(number)
    return parsed or None


def sanitize_provider_preferences(
    raw: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Sanitize provider preference payloads."""
    if not raw:
        return None
    normalized_input: Dict[str, Any] = {}
    for incoming_key, incoming_value in raw.items():
        if not isinstance(incoming_key, str):
            continue
        canonical_key = normalize_provider_key(incoming_key)
        if canonical_key:
            normalized_input[canonical_key] = incoming_value
    if not normalized_input:
        return None

    sanitized: Dict[str, Any] = {}
    for list_key in ("order", "only", "ignore", "quantizations"):
        parsed_list = coerce_string_list(normalized_input.get(list_key))
        if parsed_list:
            sanitized[list_key] = parsed_list
    for bool_key in (
        "allow_fallbacks",
        "require_parameters",
        "zdr",
        "enforce_distillable_text",
    ):
        bool_value = coerce_bool_parameter(normalized_input.get(bool_key))
        if bool_value is not None:
            sanitized[bool_key] = bool_value

    sort_value = coerce_provider_sort(normalized_input.get("sort"))
    if sort_value:
        sanitized["sort"] = sort_value

    data_collection_value = coerce_data_collection(normalized_input.get("data_collection"))
    if data_collection_value:
        sanitized["data_collection"] = data_collection_value

    max_price_value = coerce_max_price(normalized_input.get("max_price"))
    if max_price_value:
        sanitized["max_price"] = max_price_value

    return sanitized or None
