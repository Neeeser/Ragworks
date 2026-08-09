"""Export the shipped pipeline presets for the landing and README renderers.

Every graph a visitor sees comes from the builders the product itself
scaffolds with, so an illustration cannot drift from what a user gets. The
intake variants are the one exception: their scaffold lives in the frontend
(`pipeline-scaffold.ts`) because no server-side builder produces them, so this
module ships the node specs those graphs reference and the frontend builds the
graph.

The output lands in `frontend/`, where the Prettier check gates CI, and
`json.dump` cannot reproduce Prettier's short-array collapsing — so run
`npx prettier --write` on the written file afterwards. The guard test
compares parsed JSON, so reformatting never changes what it asserts.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from uuid import UUID

from app.pipelines.defaults import (
    bm25_sibling_index_name,
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.registry import default_registry
from app.pipelines.tool_defaults import (
    build_count_tool_pipeline,
    build_facet_tool_pipeline,
    with_reranker,
)
from app.schemas.enums import IndexBackend

SAMPLE_EMBEDDING_MODEL = "openai/text-embedding-3-small"
SAMPLE_RERANK_MODEL = "cohere/rerank-v3.5"
SAMPLE_INDEX_NAME = "ragworks"
# Stable placeholder: the rendered node card shows the model, not this id.
SAMPLE_CONNECTION_ID = UUID("00000000-0000-0000-0000-000000000001")
SAMPLE_BACKEND = IndexBackend.PGVECTOR

#: Node types the frontend's intake-variant scaffolds reference. Their graphs
#: are built there, so nothing here would otherwise pull their specs in — and a
#: spec the renderer cannot find draws a card with no ports.
INTAKE_SPEC_TYPES = frozenset(
    {
        "parse.embedded_media",
        "parse.media_file",
        "parse.page_images",
        "image.resize",
        "merge.items",
    }
)


def _scenes() -> list[dict[str, object]]:
    """Every server-built preset, in the order the rotation plays them."""
    embedding = {
        "embedding_connection_id": SAMPLE_CONNECTION_ID,
        "embedding_model": SAMPLE_EMBEDDING_MODEL,
        "backend": SAMPLE_BACKEND,
        "index_name": SAMPLE_INDEX_NAME,
    }
    lexical_index = bm25_sibling_index_name(SAMPLE_INDEX_NAME, SAMPLE_BACKEND)
    hybrid_search = build_default_retrieval_pipeline(**embedding)
    return [
        {
            "id": "hybrid-ingestion",
            "kind": "ingestion",
            "label": "Hybrid ingestion",
            "definition": build_default_ingestion_pipeline(**embedding),
        },
        {
            "id": "hybrid-search",
            "kind": "retrieval",
            "label": "Hybrid search",
            "definition": hybrid_search,
        },
        {
            "id": "reranked-search",
            "kind": "retrieval",
            "label": "Reranked search",
            "definition": with_reranker(
                hybrid_search,
                connection_id=SAMPLE_CONNECTION_ID,
                model_name=SAMPLE_RERANK_MODEL,
            ),
        },
        {
            "id": "count-matches",
            "kind": "retrieval",
            "label": "Count matches",
            "definition": build_count_tool_pipeline(
                backend=SAMPLE_BACKEND, index_name=lexical_index
            ),
        },
        {
            "id": "facet-by-source",
            "kind": "retrieval",
            "label": "Facet by source",
            "definition": build_facet_tool_pipeline(
                backend=SAMPLE_BACKEND, index_name=lexical_index
            ),
        },
    ]


def build_capture_payload() -> dict[str, object]:
    """Return render data sourced from the product's own pipeline builders."""
    scenes = [
        {**scene, "definition": scene["definition"].model_dump(mode="json")}  # type: ignore[union-attr]
        for scene in _scenes()
    ]
    rendered_types = {
        node["type"]
        for scene in scenes
        for node in scene["definition"]["nodes"]  # type: ignore[index]
    } | set(INTAKE_SPEC_TYPES)
    specs = [
        _pinned_spec(spec.model_dump(mode="json"))
        for spec in default_registry().specs()
        if spec.type in rendered_types
    ]
    return {"scenes": scenes, "node_specs": specs}


def _pinned_spec(spec: dict[str, object]) -> dict[str, object]:
    """Pin a spec's default backend to the one the scenes render.

    A store-bound node's `backend` default is read from the deployment's app
    config, so exporting on a Pinecone-configured machine would otherwise
    write a different committed artifact than exporting on a pgvector one.
    The illustration shows the shipped default, and a committed file must be a
    function of the code, never of the exporter's database.
    """
    config = spec.get("default_config")
    if isinstance(config, dict) and "backend" in config:
        spec["default_config"] = {**config, "backend": SAMPLE_BACKEND.value}
    return spec


def main() -> None:
    """Write the capture fixture to the requested path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(build_capture_payload(), indent=2) + "\n")


if __name__ == "__main__":
    main()
