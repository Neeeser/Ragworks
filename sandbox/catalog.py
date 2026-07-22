"""Render the scenario catalog markdown from registry metadata.

`docs/sandbox-scenarios.md` is generated, never hand-edited — a test regenerates
and diffs it so the catalog an agent reads always matches the scenarios the
code actually seeds.
"""

from __future__ import annotations

from sandbox.keys import required_env_vars
from sandbox.registry import ScenarioSpec, all_scenarios

HEADER = """\
# Sandbox scenario catalog

Generated from the scenario registry by `uv run python -m sandbox docs` — do not
edit by hand (a test diffs this file against the registry). Usage, key setup,
and how to add scenarios: [sandbox.md](sandbox.md).

Seed any of these with `uv run python -m sandbox up <name>` (servers on
http://127.0.0.1:3010 / http://127.0.0.1:8010) or `... seed <name>` (state
only). Every seeded scenario with a user logs in as `sandbox@ragworks.dev` /
`ragworks-sandbox`; the seed command also prints a ready JWT.
"""


def render_catalog() -> str:
    """The full catalog markdown."""
    sections = [HEADER, _summary_table()]
    sections.extend(_section(spec) for spec in all_scenarios())
    return "\n".join(sections)


def _summary_table() -> str:
    rows = ["| scenario | state | needs keys |", "| --- | --- | --- |"]
    rows.extend(
        f"| `{spec.name}` | {spec.description} | {_requires_cell(spec)} |"
        for spec in all_scenarios()
    )
    return "\n".join(rows) + "\n"


def _requires_cell(spec: ScenarioSpec) -> str:
    if not spec.requires:
        return "none"
    return ", ".join(
        f"`{env_var}`"
        for provider in spec.requires
        for env_var in required_env_vars(provider)
    )


def _section(spec: ScenarioSpec) -> str:
    lines = [f"## `{spec.name}`", "", spec.description, ""]
    if spec.requires:
        lines.append(f"Requires: {_requires_cell(spec)} in `.env.sandbox`.")
        lines.append("")
    lines.append("After seeding:")
    lines.extend(f"- {item}" for item in spec.state)
    lines.append("")
    return "\n".join(lines)
