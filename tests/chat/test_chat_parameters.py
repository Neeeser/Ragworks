from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.chat.parameters import (
    normalize_reasoning_effort,
    prepare_reasoning_override,
    sanitize_parameter_overrides,
)
from app.schemas.chat_parameters import (
    ChatParameters,
    ProviderPreferences,
    coerce_bool_parameter,
    coerce_data_collection,
    coerce_dict_parameter,
    coerce_list_parameter,
    coerce_max_price,
    coerce_numeric_parameter,
    coerce_provider_sort,
    coerce_string_list,
)

# --- sanitize_parameter_overrides -------------------------------------------


def test_sanitize_parameter_overrides_coerces_and_filters() -> None:
    supported = [
        "temperature",
        "top_k",
        "logprobs",
        "stop",
        "verbosity",
        "response_format",
        "reasoning",
    ]
    parameters = ChatParameters(
        temperature="0.7",
        top_k="4",
        logprobs="true",
        stop="end,\nstop",
        verbosity="HIGH",
        response_format={"type": "json_object"},
        reasoning={"effort": "high"},
        unknown="ignore-me",  # type: ignore[call-arg]
    )

    sanitized = sanitize_parameter_overrides(parameters, supported)

    assert sanitized["temperature"] == 0.7
    assert sanitized["top_k"] == 4
    assert sanitized["logprobs"] is True
    assert sanitized["stop"] == ["end", "stop"]
    assert sanitized["verbosity"] == "high"
    assert sanitized["response_format"] == {"type": "json_object"}
    assert sanitized["reasoning"] == {"effort": "high"}
    assert "unknown" not in sanitized


def test_sanitize_parameter_overrides_skips_invalid_values() -> None:
    supported = ["temperature", "verbosity", "stop", "response_format"]
    parameters = ChatParameters(
        temperature="nan",
        verbosity="louder",
        stop="",
        response_format="not-json",  # type: ignore[arg-type]
    )

    sanitized = sanitize_parameter_overrides(parameters, supported)

    assert sanitized == {}


def test_sanitize_parameter_overrides_returns_empty_for_missing_inputs() -> None:
    assert sanitize_parameter_overrides(None, ["temperature"]) == {}
    assert sanitize_parameter_overrides(ChatParameters(temperature=0.5), None) == {}


def test_sanitize_parameter_overrides_drops_fields_the_model_does_not_support() -> None:
    parameters = ChatParameters(temperature=0.5, top_k=3)

    sanitized = sanitize_parameter_overrides(parameters, ["top_k"])

    assert sanitized == {"top_k": 3}


# --- ChatParameters + coercers ----------------------------------------------


def test_chat_parameters_drops_unknown_keys() -> None:
    parameters = ChatParameters.model_validate({"temperature": 0.5, "unknown": "value"})

    assert parameters.temperature == 0.5
    assert not hasattr(parameters, "unknown")


def test_chat_parameters_verbosity_and_unsupported_values() -> None:
    assert ChatParameters(verbosity="HIGH").verbosity == "high"  # type: ignore[arg-type]
    assert ChatParameters(verbosity=123).verbosity is None  # type: ignore[arg-type]
    assert ChatParameters(verbosity="loud").verbosity is None  # type: ignore[arg-type]


def test_coerce_dict_parameter_parses_json_string() -> None:
    assert coerce_dict_parameter('{"type":"json_object"}') == {"type": "json_object"}
    assert coerce_dict_parameter(" ") is None


def test_coerce_dict_parameter_rejects_none_and_non_dict_json() -> None:
    assert coerce_dict_parameter(None) is None
    assert coerce_dict_parameter('["list"]') is None
    assert coerce_dict_parameter(123) is None


def test_coerce_list_parameter_returns_none_for_empty_values() -> None:
    assert coerce_list_parameter(None) is None


def test_coerce_list_parameter_parses_string_and_list() -> None:
    assert coerce_list_parameter("one,\n two") == ["one", "two"]
    assert coerce_list_parameter(["a", " ", None, 3]) == ["a", "3"]


def test_coerce_list_parameter_handles_scalar_value() -> None:
    assert coerce_list_parameter(7) == ["7"]


def test_coerce_numeric_parameter_rejects_non_finite() -> None:
    assert coerce_numeric_parameter("nan") is None
    assert coerce_numeric_parameter(float("inf")) is None


def test_coerce_numeric_parameter_rejects_empty_and_invalid_types() -> None:
    assert coerce_numeric_parameter(None) is None
    assert coerce_numeric_parameter("   ") is None
    assert coerce_numeric_parameter(["1"]) is None


def test_coerce_bool_parameter_from_strings() -> None:
    assert coerce_bool_parameter("yes") is True
    assert coerce_bool_parameter("off") is False
    assert coerce_bool_parameter("maybe") is None


def test_coerce_bool_parameter_from_bool_and_number() -> None:
    assert coerce_bool_parameter(True) is True
    assert coerce_bool_parameter(0) is False


def test_coerce_string_list_handles_mixed_iterables() -> None:
    assert coerce_string_list((" a ", None, 2)) == ["a", "2"]
    assert coerce_string_list(["a", " ", None, "b"]) == ["a", "b"]
    assert coerce_string_list("a, ,b") == ["a", "b"]
    assert coerce_string_list([None, " "]) is None
    assert coerce_string_list(123) is None


# --- reasoning override shaping ---------------------------------------------


def test_normalize_reasoning_effort_handles_non_string() -> None:
    assert normalize_reasoning_effort(123) is None


def test_prepare_reasoning_override_coerces_values() -> None:
    raw = {
        "effort": "HIGH",
        "max_tokens": "120",
        "exclude": "true",
        "enabled": "0",
        "extra": "ignore",
    }

    assert prepare_reasoning_override(raw) == {
        "effort": "high",
        "max_tokens": 120,
        "exclude": True,
        "enabled": False,
    }


def test_prepare_reasoning_override_accepts_string_effort() -> None:
    assert prepare_reasoning_override("LOW") == {"effort": "low"}


def test_prepare_reasoning_override_filters_invalid_values() -> None:
    raw = {"effort": "loud", "max_tokens": "invalid", "exclude": "maybe"}

    assert prepare_reasoning_override(raw) is None


def test_prepare_reasoning_override_rejects_invalid_string() -> None:
    assert prepare_reasoning_override("fast") is None


# --- ProviderPreferences (validated directly; no compat wrapper) -------------


def test_provider_preferences_normalizes_aliases() -> None:
    raw = {
        "order": "router-a,router-b",
        "ignore": ["router-c", None, " "],
        "only": ["router-d"],
        "allowFallbacks": "yes",
        "require-parameters": "off",
        "data-collection": "deny",
        "sort": "latency",
        "MaxPrice": {"prompt": "0.002", "completion": "invalid"},
        12: "ignored",
    }

    sanitized = ProviderPreferences.model_validate(raw).to_request_payload()

    assert sanitized is not None
    assert sanitized["order"] == ["router-a", "router-b"]
    assert sanitized["ignore"] == ["router-c"]
    assert sanitized["only"] == ["router-d"]
    assert sanitized["allow_fallbacks"] is True
    assert sanitized["require_parameters"] is False
    assert sanitized["data_collection"] == "deny"
    assert sanitized["sort"] == "latency"
    assert sanitized["max_price"] == {"prompt": 0.002}


def test_provider_preferences_model_drops_unknown_keys() -> None:
    prefs = ProviderPreferences.model_validate({"unsupported": "value"})

    assert prefs.to_request_payload() is None


def test_provider_preferences_model_validate_rejects_non_dict_input() -> None:
    """A non-dict payload must raise a clean ValidationError, not crash on `.items()`."""
    with pytest.raises(ValidationError):
        ProviderPreferences.model_validate(["not", "a", "dict"])


def test_provider_preference_helpers_reject_invalid_values() -> None:
    assert coerce_provider_sort("speed") is None
    assert coerce_data_collection("maybe") is None
    assert coerce_max_price("0.1") is None


def test_provider_option_coercers_accept_none() -> None:
    assert coerce_provider_sort(None) is None
    assert coerce_data_collection(None) is None


def test_provider_preferences_accepts_sort_and_price() -> None:
    raw = {"sort": "price", "data_collection": "allow", "max_price": {"request": "0.5"}}

    sanitized = ProviderPreferences.model_validate(raw).to_request_payload()

    assert sanitized == {
        "sort": "price",
        "data_collection": "allow",
        "max_price": {"request": 0.5},
    }


def test_provider_preferences_skips_invalid_sort_and_price() -> None:
    raw = {
        "order": "router-a",
        "sort": "fastest",
        "data_collection": "maybe",
        "max_price": {"prompt": "invalid"},
    }

    sanitized = ProviderPreferences.model_validate(raw).to_request_payload()

    assert sanitized == {"order": ["router-a"]}
