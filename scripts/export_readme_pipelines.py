"""Export the shipped default pipelines for the README animation renderer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from uuid import UUID

from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.registry import default_registry
from app.schemas.enums import IndexBackend

SAMPLE_EMBEDDING_MODEL = "openai/text-embedding-3-small"
SAMPLE_INDEX_NAME = "ragworks"
# Stable placeholder: the rendered node card shows the model, not this id.
SAMPLE_CONNECTION_ID = UUID("00000000-0000-0000-0000-000000000001")


def build_capture_payload() -> dict[str, object]:
    """Return render data sourced from the backend's default pipeline builders."""
    options = {
        "embedding_connection_id": SAMPLE_CONNECTION_ID,
        "embedding_model": SAMPLE_EMBEDDING_MODEL,
        "backend": IndexBackend.PGVECTOR,
        "index_name": SAMPLE_INDEX_NAME,
    }
    scenes = [
        {
            "kind": "ingestion",
            "definition": build_default_ingestion_pipeline(**options).model_dump(mode="json"),
        },
        {
            "kind": "retrieval",
            "definition": build_default_retrieval_pipeline(**options).model_dump(mode="json"),
        },
    ]
    rendered_types = {
        node["type"]
        for scene in scenes
        for node in scene["definition"]["nodes"]  # type: ignore[index]
    }
    specs = [
        spec.model_dump(mode="json")
        for spec in default_registry().specs()
        if spec.type in rendered_types
    ]
    return {"scenes": scenes, "node_specs": specs}


def main() -> None:
    """Write the capture fixture to the requested path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(build_capture_payload(), indent=2) + "\n")


if __name__ == "__main__":
    main()
