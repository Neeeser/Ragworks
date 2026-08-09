"""Tests for the landing/README pipeline capture fixture exporter."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.export_readme_pipelines import INTAKE_SPEC_TYPES, build_capture_payload

COMMITTED_FIXTURE = Path("frontend/src/components/readme/readme-pipelines.generated.json")


def test_exporter_writes_every_preset_from_the_product_builders(tmp_path: Path) -> None:
    """The capture fixture comes from the shipped builders, not a parallel graph."""
    output = tmp_path / "readme-pipelines.json"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.export_readme_pipelines",
            "--output",
            str(output),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(output.read_text())
    by_id = {scene["id"]: scene for scene in payload["scenes"]}
    assert set(by_id) == {
        "hybrid-ingestion",
        "hybrid-search",
        "reranked-search",
        "count-matches",
        "facet-by-source",
    }
    assert all(scene["label"] for scene in payload["scenes"])

    assert {node["type"] for node in by_id["hybrid-ingestion"]["definition"]["nodes"]} >= {
        "indexer.vector",
        "indexer.bm25",
    }
    hybrid_search = by_id["hybrid-search"]["definition"]
    assert {node["type"] for node in hybrid_search["nodes"]} >= {
        "retriever.vector",
        "retriever.bm25",
        "fusion.rrf",
        "limit.results",
    }
    assert [variable["name"] for variable in hybrid_search["variables"]] == ["result_limit"]

    # The reranked preset is the hybrid graph plus the reranker, so a drift in
    # either shows up here rather than as a card the illustration cannot draw.
    reranked = by_id["reranked-search"]["definition"]
    assert {node["type"] for node in reranked["nodes"]} == {
        node["type"] for node in hybrid_search["nodes"]
    } | {"reranker.model"}
    assert {node["type"] for node in by_id["count-matches"]["definition"]["nodes"]} >= {
        "count.bm25"
    }
    assert {node["type"] for node in by_id["facet-by-source"]["definition"]["nodes"]} >= {
        "facet.bm25"
    }


def test_node_specs_cover_every_rendered_node_including_the_intake_variants(
    tmp_path: Path,
) -> None:
    """A node whose spec is missing renders as a card with no ports.

    The intake-variant graphs are built in the frontend, so their specs reach
    the renderer only because this exporter is told to include them.
    """
    output = tmp_path / "readme-pipelines.json"
    subprocess.run(
        [sys.executable, "-m", "scripts.export_readme_pipelines", "--output", str(output)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(output.read_text())

    rendered_types = {
        node["type"] for scene in payload["scenes"] for node in scene["definition"]["nodes"]
    }
    exported = {spec["type"] for spec in payload["node_specs"]}
    assert exported == rendered_types | set(INTAKE_SPEC_TYPES)


def test_committed_fixture_matches_the_product_builders() -> None:
    """Landing and README consumers must never render a stale graph."""
    assert json.loads(COMMITTED_FIXTURE.read_text()) == build_capture_payload()
