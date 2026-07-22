"""Scenario registry: `@scenario` metadata + discovery.

The generated catalog (``docs/sandbox-scenarios.md``) renders from this metadata,
so a scenario's name, description, key requirements, and state summary live
in exactly one place — next to the seed code they describe.
"""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable
from dataclasses import dataclass, field

from sandbox.context import SeedContext

SeedFn = Callable[[SeedContext], None]


@dataclass(frozen=True)
class ScenarioSpec:
    """One named, seedable application state."""

    name: str
    description: str
    seed: SeedFn
    requires: tuple[str, ...] = ()
    state: tuple[str, ...] = field(default_factory=tuple)


_SCENARIOS: dict[str, ScenarioSpec] = {}


def scenario(
    *,
    name: str,
    description: str,
    requires: tuple[str, ...] = (),
    state: tuple[str, ...] = (),
) -> Callable[[SeedFn], SeedFn]:
    """Register a seed function as a named scenario.

    `state` is the catalog's bullet list of what exists after seeding — keep
    it accurate; it is what an agent reads instead of exploring the app.
    """

    def register(fn: SeedFn) -> SeedFn:
        if name in _SCENARIOS:
            raise ValueError(f"Duplicate scenario name '{name}'.")
        _SCENARIOS[name] = ScenarioSpec(
            name=name, description=description, seed=fn, requires=requires, state=state
        )
        return fn

    return register


def load_scenarios() -> None:
    """Import every module in ``sandbox.scenarios`` so decorators register."""
    from sandbox import scenarios as package

    for module in pkgutil.iter_modules(package.__path__):
        importlib.import_module(f"{package.__name__}.{module.name}")


def all_scenarios() -> list[ScenarioSpec]:
    """Registered scenarios, sorted by name."""
    load_scenarios()
    return sorted(_SCENARIOS.values(), key=lambda spec: spec.name)


def get_scenario(name: str) -> ScenarioSpec:
    """Resolve a scenario by name, listing valid names on a miss."""
    load_scenarios()
    spec = _SCENARIOS.get(name)
    if spec is None:
        names = ", ".join(sorted(_SCENARIOS))
        raise SystemExit(f"Unknown scenario '{name}'. Available: {names}")
    return spec
