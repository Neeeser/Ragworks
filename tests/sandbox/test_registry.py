"""Scenario registry contracts: discovery, metadata, and key requirements."""

from __future__ import annotations

import pytest

from sandbox.keys import PROVIDER_SPECS
from sandbox.registry import all_scenarios, get_scenario


def test_scenarios_register_with_complete_metadata() -> None:
    """Every scenario carries the metadata the catalog and CLI rely on."""
    scenarios = all_scenarios()
    assert {spec.name for spec in scenarios} >= {
        "blank",
        "fresh-user",
        "connected",
        "collection-ready",
        "evals-ready",
    }
    for spec in scenarios:
        assert spec.description.strip(), f"{spec.name} has no description"
        assert spec.state, f"{spec.name} documents no seeded state"


def test_every_requirement_maps_to_a_known_env_var() -> None:
    """A scenario can only require providers the preflight knows how to check."""
    for spec in all_scenarios():
        for provider in spec.requires:
            assert provider in PROVIDER_SPECS, (
                f"{spec.name} requires unknown provider '{provider}'"
            )


def test_unknown_scenario_lists_available_names() -> None:
    """A typo'd name fails with the valid names, not a stack trace."""
    with pytest.raises(SystemExit, match="blank"):
        get_scenario("does-not-exist")
