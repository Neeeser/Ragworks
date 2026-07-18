"""Tests for the README pipeline capture fixture exporter."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.export_readme_pipelines import build_capture_payload

COMMITTED_FIXTURE = Path("frontend/src/components/readme/readme-pipelines.generated.json")


def test_exporter_writes_backend_defaults_and_required_node_specs(tmp_path: Path) -> None:
    """The capture fixture comes from the backend defaults, not a parallel graph."""
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
    assert [scene["kind"] for scene in payload["scenes"]] == ["ingestion", "retrieval"]

    ingestion, retrieval = (scene["definition"] for scene in payload["scenes"])
    assert {node["type"] for node in ingestion["nodes"]} >= {
        "indexer.vector",
        "indexer.bm25",
    }
    assert {node["type"] for node in retrieval["nodes"]} >= {
        "retriever.vector",
        "retriever.bm25",
        "fusion.rrf",
        "limit.results",
    }
    assert [variable["name"] for variable in retrieval["variables"]] == ["result_limit"]

    rendered_types = {
        node["type"] for scene in payload["scenes"] for node in scene["definition"]["nodes"]
    }
    assert {spec["type"] for spec in payload["node_specs"]} == rendered_types


def test_committed_fixture_matches_backend_defaults() -> None:
    """Landing and README consumers must never render a stale default graph."""
    assert json.loads(COMMITTED_FIXTURE.read_text()) == build_capture_payload()
