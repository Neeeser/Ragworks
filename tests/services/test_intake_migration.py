"""The stored-definition migration onto item-borne file intake.

Built from raw JSON rows in the shape deployments actually stored, because
that is the only shape this step ever sees: the node types it rewrites are
no longer registered, so a row still holding one cannot be parsed at all.
"""

from __future__ import annotations

from typing import Any

from app.pipelines.definition import PipelineDefinition
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator
from app.services.intake_migration import migrate_intake_definition


def _linear_text_pipeline() -> dict[str, Any]:
    """The old default: input -> parser -> chunker -> embed -> index -> out."""
    return {
        "nodes": [
            {"id": "in", "type": "ingestion.input", "name": "In", "config": {}},
            {
                "id": "parse",
                "type": "parser.document",
                "name": "Document Parser",
                "config": {"mode": "auto", "encoding": "utf-16"},
            },
            {
                "id": "chunk",
                "type": "chunker.token",
                "name": "Chunker",
                "config": {"chunk_size": 400, "chunk_overlap": 80},
            },
            {
                "id": "embed",
                "type": "embedder.text",
                "name": "Embedder",
                "config": {"connection_id": "1f0b6f22-0000-4000-8000-000000000001", "model_name": "e"},
            },
            {
                "id": "index",
                "type": "indexer.vector",
                "name": "Indexer",
                "config": {"backend": "pgvector", "index_name": "docs", "dimension": 4},
            },
            {"id": "out", "type": "ingestion.output", "name": "Out", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "in", "target": "parse", "source_port": "source", "target_port": "source"},
            {"id": "e2", "source": "parse", "target": "chunk", "source_port": "document", "target_port": "document"},
            {"id": "e3", "source": "chunk", "target": "embed", "source_port": "items", "target_port": "items"},
            {"id": "e4", "source": "embed", "target": "index", "source_port": "items", "target_port": "items"},
            {"id": "e5", "source": "index", "target": "out", "source_port": "items", "target_port": "items"},
        ],
        "viewport": {},
        "schema_version": 4,
    }


def _routed_multimodal_pipeline() -> dict[str, Any]:
    """The old multimodal shape: a 4-way router feeding format-specific nodes."""
    return {
        "nodes": [
            {"id": "in", "type": "ingestion.input", "name": "In", "config": {}},
            {"id": "route", "type": "router.file_type", "name": "Router", "config": {}},
            {"id": "parse", "type": "parser.document", "name": "Parser", "config": {"mode": "pdf"}},
            {
                "id": "pdf-images",
                "type": "pdf.images",
                "name": "PDF Images",
                "config": {"min_width": 32, "min_height": 32},
            },
            {"id": "image-in", "type": "image.source", "name": "Image Source", "config": {}},
            {"id": "out", "type": "ingestion.output", "name": "Out", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "in", "target": "route", "source_port": "source", "target_port": "source"},
            {"id": "e2", "source": "route", "target": "parse", "source_port": "pdf", "target_port": "source"},
            {"id": "e3", "source": "route", "target": "pdf-images", "source_port": "pdf", "target_port": "source"},
            {"id": "e4", "source": "route", "target": "image-in", "source_port": "image", "target_port": "source"},
            {"id": "e5", "source": "image-in", "target": "out", "source_port": "items", "target_port": "items"},
        ],
        "viewport": {},
        "schema_version": 4,
    }


def _converging_router_pipeline() -> dict[str, Any]:
    """A router whose text and pdf branches both feed the one parser.

    Stored pipelines converge routes routinely — the same extractor
    handles both formats — and every such branch reconnects to the same
    feeder, so the migration has to collapse what becomes one edge.
    """
    return {
        "nodes": [
            {"id": "in", "type": "ingestion.input", "name": "In", "config": {}},
            {"id": "route", "type": "router.file_type", "name": "Router", "config": {}},
            {"id": "parse", "type": "parser.document", "name": "Parser", "config": {}},
            {
                "id": "chunk",
                "type": "chunker.token",
                "name": "Chunker",
                "config": {"chunk_size": 400, "chunk_overlap": 80},
            },
            {
                "id": "embed",
                "type": "embedder.text",
                "name": "Embedder",
                "config": {
                    "connection_id": "1f0b6f22-0000-4000-8000-000000000001",
                    "model_name": "e",
                },
            },
            {
                "id": "index",
                "type": "indexer.vector",
                "name": "Indexer",
                "config": {"backend": "pgvector", "index_name": "docs", "dimension": 4},
            },
            {"id": "out", "type": "ingestion.output", "name": "Out", "config": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "in",
                "target": "route",
                "source_port": "source",
                "target_port": "source",
            },
            {
                "id": "e2",
                "source": "route",
                "target": "parse",
                "source_port": "pdf",
                "target_port": "source",
            },
            {
                "id": "e3",
                "source": "route",
                "target": "parse",
                "source_port": "text",
                "target_port": "source",
            },
            {
                "id": "e4",
                "source": "parse",
                "target": "chunk",
                "source_port": "document",
                "target_port": "document",
            },
            {
                "id": "e5",
                "source": "chunk",
                "target": "embed",
                "source_port": "items",
                "target_port": "items",
            },
            {
                "id": "e6",
                "source": "embed",
                "target": "index",
                "source_port": "items",
                "target_port": "items",
            },
            {
                "id": "e7",
                "source": "index",
                "target": "out",
                "source_port": "items",
                "target_port": "items",
            },
        ],
        "viewport": {},
        "schema_version": 4,
    }


def _edge(definition: dict[str, Any], edge_id: str) -> dict[str, Any]:
    return next(edge for edge in definition["edges"] if edge["id"] == edge_id)


def test_the_parser_becomes_extract_text_keeping_only_its_encoding() -> None:
    migrated = migrate_intake_definition(_linear_text_pipeline())

    parse = next(node for node in migrated["nodes"] if node["id"] == "parse")
    assert parse["type"] == "parse.text"
    # `mode` no longer exists — the handler registry selects on content type.
    assert parse["config"] == {"encoding": "utf-16"}


def test_intake_edges_move_onto_the_items_plane() -> None:
    migrated = migrate_intake_definition(_linear_text_pipeline())

    assert _edge(migrated, "e1")["source_port"] == "items"
    assert _edge(migrated, "e2")["source_port"] == "items"
    assert _edge(migrated, "e2")["target_port"] == "items"


def test_a_migrated_definition_parses_and_validates() -> None:
    """The point of the step: the row the schema could not parse now runs."""
    migrated = migrate_intake_definition(_linear_text_pipeline())

    definition = PipelineDefinition.model_validate(migrated)
    result = PipelineValidator(default_registry()).validate(definition)

    assert result.errors == []


def test_the_router_is_deleted_and_its_targets_reconnect_to_the_input() -> None:
    migrated = migrate_intake_definition(_routed_multimodal_pipeline())

    assert [node["type"] for node in migrated["nodes"] if node["type"].startswith("router")] == []
    for edge_id in ("e2", "e3", "e4"):
        edge = _edge(migrated, edge_id)
        assert edge["source"] == "in"
        assert edge["source_port"] == "items"
        assert edge["target_port"] == "source"
    # The edge that fed the router is gone with it.
    assert not [edge for edge in migrated["edges"] if edge["id"] == "e1"]


def test_the_image_nodes_become_their_capability_nodes() -> None:
    migrated = migrate_intake_definition(_routed_multimodal_pipeline())

    by_id = {node["id"]: node for node in migrated["nodes"]}
    assert by_id["image-in"]["type"] == "parse.media_file"
    assert by_id["pdf-images"]["type"] == "parse.embedded_media"
    assert by_id["pdf-images"]["config"] == {"min_width": 32, "min_height": 32}


def test_a_migrated_router_pipeline_parses() -> None:
    migrated = migrate_intake_definition(_routed_multimodal_pipeline())

    definition = PipelineDefinition.model_validate(migrated)

    assert {node.type for node in definition.nodes} == {
        "ingestion.input",
        "parse.text",
        "parse.embedded_media",
        "parse.media_file",
        "ingestion.output",
    }


def test_converging_router_branches_collapse_into_one_edge() -> None:
    """Two router ports reaching one node must not become two identical edges.

    A parse node's input takes a single edge, so the duplicate would fail
    validation and every ingest on that collection with it.
    """
    migrated = migrate_intake_definition(_converging_router_pipeline())

    into_parse = [edge for edge in migrated["edges"] if edge["target"] == "parse"]
    assert len(into_parse) == 1

    definition = PipelineDefinition.model_validate(migrated)
    result = PipelineValidator(default_registry()).validate(definition)

    assert result.errors == []


def test_a_current_definition_is_left_untouched() -> None:
    """Idempotence: the step runs on every boot, against already-migrated rows."""
    migrated = migrate_intake_definition(_linear_text_pipeline())

    assert migrate_intake_definition(migrated) == migrated
