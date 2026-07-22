"""The committed scenario catalog must match the registry (generated, never stale)."""

from __future__ import annotations

from pathlib import Path

from sandbox.catalog import render_catalog

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CATALOG = REPO_ROOT / "docs" / "sandbox-scenarios.md"


def test_committed_catalog_matches_registry() -> None:
    """docs/sandbox-scenarios.md is exactly what the registry renders.

    A drifting catalog silently lies to every agent that reads it instead of
    exploring the app; regenerate with `uv run python -m sandbox docs`.
    """
    assert CATALOG.read_text(encoding="utf-8") == render_catalog(), (
        "docs/sandbox-scenarios.md is stale — run `uv run python -m sandbox docs` and commit it."
    )
