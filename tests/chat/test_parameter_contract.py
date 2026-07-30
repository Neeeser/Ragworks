"""Pin the backend side of the shared chat-parameter contract.

The same `tests/assets/chat_parameter_contract.json` is asserted by vitest on
the frontend, so a key added or renamed on either side fails a gate instead of
being silently dropped. Both drop directions are invisible without this:
`ChatParameters` ignores unknown keys, and the panel renders only keys it has a
definition for — so a backend-only field never appears in the UI and a
frontend-only key never reaches the provider.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.chat.parameters import REASONING_EFFORT_OPTIONS
from app.schemas.chat_parameters import ChatParameters
from app.schemas.models import CAPABILITY_MARKERS, ReasoningStyle, SamplingSupport

_CONTRACT = json.loads(
    (Path(__file__).resolve().parents[1] / "assets" / "chat_parameter_contract.json").read_text()
)


def test_chat_parameters_fields_match_the_contract() -> None:
    """Every wire field is either a sampling knob, a capability control, or
    the pass-through — and the contract names all three sets."""
    expected = {
        *_CONTRACT["sampling_parameters"],
        *_CONTRACT["capability_controls"],
        _CONTRACT["passthrough_parameter"],
    }
    assert set(ChatParameters.model_fields) == expected


def test_capability_controls_are_not_wire_parameter_markers() -> None:
    """A capability control is rendered like a knob but is a claim: it must be
    in the marker set that gets split out of a provider's flat list."""
    for control in _CONTRACT["capability_controls"]:
        assert control in CAPABILITY_MARKERS


def test_reasoning_effort_vocabulary_matches_the_contract() -> None:
    assert set(_CONTRACT["reasoning_efforts"]) == REASONING_EFFORT_OPTIONS


def test_reasoning_styles_match_the_contract() -> None:
    assert {style.value for style in ReasoningStyle} == set(_CONTRACT["reasoning_styles"])


def test_sampling_support_states_match_the_contract() -> None:
    assert {state.value for state in SamplingSupport} == set(_CONTRACT["sampling_support"])


def test_sampling_knobs_are_real_chat_parameters() -> None:
    """The knobs a reasoning model refuses must be fields the wire carries —
    a renamed one would leave the panel gating a control nothing sends."""
    for knob in _CONTRACT["sampling_knobs"]:
        assert knob in ChatParameters.model_fields
