"""Regression coverage for optional Docker Compose inference overlays."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterable
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BASE_COMPOSE = ROOT / "docker-compose.yml"
README = ROOT / "README.md"
DOCKER_SETUPS = ROOT / "docs/docker-setups.md"
OVERLAYS = {
    "ollama": ROOT / "deploy/compose/ollama.yml",
    "tei-embedding": ROOT / "deploy/compose/tei-embedding.yml",
    "tei-reranker": ROOT / "deploy/compose/tei-reranker.yml",
}
BASE_SERVICES = {"ragworks"}
COMBINATIONS = (
    (),
    ("ollama",),
    ("tei-embedding",),
    ("tei-reranker",),
    ("ollama", "tei-embedding"),
    ("ollama", "tei-reranker"),
    ("tei-embedding", "tei-reranker"),
    ("ollama", "tei-embedding", "tei-reranker"),
)


def _read_quick_start_compose() -> str:
    readme = README.read_text()
    marker = "Ragworks publishes one container image per release. It contains the backend, the\n"
    start = readme.index(marker)
    fenced_start = readme.index("```yaml\n", start) + len("```yaml\n")
    fenced_end = readme.index("```\n", fenced_start)
    return readme[fenced_start:fenced_end]


def _render(overlays: Iterable[str]) -> dict[str, object]:
    command = ["docker", "compose", "-f", str(BASE_COMPOSE)]
    command.extend(flag for name in overlays for flag in ("-f", str(OVERLAYS[name])))
    command.extend(("config", "--format", "json"))
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_readme_quick_start_compose_matches_root_compose_file() -> None:
    """The standalone quick-start stack must remain an exact copy of the root file."""
    assert _read_quick_start_compose() == BASE_COMPOSE.read_text()


def test_arm64_example_uses_the_published_tei_image_tag() -> None:
    """The ARM example must name the GHCR tag that can actually be pulled."""
    guide = DOCKER_SETUPS.read_text()

    assert "cpu-arm64-latest" in guide
    assert "text-embeddings-inference:cpu-arm64-1.9" not in guide


@pytest.mark.parametrize("overlays", COMBINATIONS)
def test_every_documented_overlay_combination_renders(overlays: tuple[str, ...]) -> None:
    """Every documented CLI stack must merge into a valid Compose configuration."""
    for name in overlays:
        assert OVERLAYS[name].is_file(), f"missing overlay: {OVERLAYS[name]}"

    rendered = _render(overlays)
    expected_services = BASE_SERVICES | set(overlays)

    assert set(rendered["services"]) == expected_services
