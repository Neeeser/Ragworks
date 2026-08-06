"""Startup migration from the document planes to item-borne file intake.

Works on raw stored JSON, and runs before every step that parses a
definition: the node types it rewrites are no longer registered and the
port kinds they used are gone, so validating such a row raises in
`lifespan` and the process dies before this step could fix it.

What changes, per stored definition:

- `parser.document` becomes `parse.text` (its `mode` no longer exists;
  the handler registry selects on content type instead), configured to
  decode unknown formats as text so the types it indexed today keep
  being indexed.
- `image.source` becomes `parse.media_file`; `pdf.images` becomes
  `parse.embedded_media`, keeping its size floor.
- `router.file_type` is deleted and each of its outbound edges is
  reconnected to whatever fed the router. The router's pdf-only gating
  dissolves — each parse node now self-selects by content type.
- Edge port keys follow the node types onto the items plane.
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session

from app.db.repositories import PipelineVersionRepository

ROUTER_TYPE = "router.file_type"
CHUNKER_PREFIX = "chunker."
INGESTION_INPUT_TYPE = "ingestion.input"

@dataclass(frozen=True)
class _TypeMigration:
    """Where an old node type lands, and what config comes with it."""

    new_type: str
    #: Config keys the new node still understands; everything else drops.
    kept: frozenset[str] = frozenset()
    #: Config the new node needs to keep behaving as the old one did.
    seeded: Mapping[str, object] = field(default_factory=dict)


#: Old node type -> where it lands. `parse.text` is seeded with
#: `plain_text` because the parser's `auto` mode decoded every type it had
#: no dedicated reader for; a fresh scaffold keeps the stricter `skip`
#: default, but flipping a migrated pipeline to it would silently stop
#: indexing the formats it indexes today.
_TYPE_MIGRATIONS: dict[str, _TypeMigration] = {
    "parser.document": _TypeMigration(
        "parse.text", frozenset({"encoding"}), {"unknown_format": "plain_text"}
    ),
    "image.source": _TypeMigration("parse.media_file"),
    "pdf.images": _TypeMigration(
        "parse.embedded_media", frozenset({"min_width", "min_height"})
    ),
}

#: New node type -> the single output port key it now emits on.
_OUTPUT_PORTS = {
    INGESTION_INPUT_TYPE: "items",
    "parse.text": "items",
    "parse.media_file": "items",
    "parse.embedded_media": "items",
}


def migrate_intake_definition(definition: dict[str, Any]) -> dict[str, Any]:
    """Rewrite one stored definition onto the item-borne intake shape."""
    migrated = deepcopy(definition)
    nodes: list[dict[str, Any]] = migrated.get("nodes") or []
    edges: list[dict[str, Any]] = migrated.get("edges") or []
    _migrate_node_types(nodes)
    edges = _remove_routers(nodes, edges)
    types = {node.get("id"): node.get("type") for node in nodes}
    _rename_ports(edges, types)
    migrated["nodes"] = nodes
    migrated["edges"] = _dedupe_edges(edges)
    return migrated


def _migrate_node_types(nodes: list[dict[str, Any]]) -> None:
    """Rename the removed node types and drop config they no longer carry."""
    for node in nodes:
        node_type = node.get("type")
        migration = _TYPE_MIGRATIONS.get(node_type) if isinstance(node_type, str) else None
        if migration is None:
            continue
        node["type"] = migration.new_type
        node["config"] = {
            key: value
            for key, value in (node.get("config") or {}).items()
            if key in migration.kept
        } | dict(migration.seeded)


def _remove_routers(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Delete every router, reconnecting its targets to whatever fed it.

    An outbound edge keeps its id, target, and target port — only its
    source moves — so nothing downstream has to be rewritten and no new
    edge id can collide.
    """
    router_ids = {node["id"] for node in nodes if node.get("type") == ROUTER_TYPE}
    if not router_ids:
        return edges
    upstream = {
        edge["target"]: edge
        for edge in edges
        if edge.get("target") in router_ids and edge.get("source") not in router_ids
    }
    reconnected: list[dict[str, Any]] = []
    for edge in edges:
        if edge.get("target") in router_ids:
            continue
        source = edge.get("source")
        if source in router_ids:
            feeding = upstream.get(source)
            if feeding is None:
                continue  # nothing fed the router; the branch was already dead
            edge = {**edge, "source": feeding["source"], "source_port": feeding.get("source_port")}
        reconnected.append(edge)
    nodes[:] = [node for node in nodes if node.get("id") not in router_ids]
    return reconnected


def _dedupe_edges(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the first edge for each source/target port pair.

    Router branches converge: text and pdf both feeding one extractor is
    an ordinary stored shape, and reconnecting each branch to the router's
    feeder turns them into the same edge. A non-variadic input takes one
    edge, so leaving both makes the migrated pipeline fail validation and
    every ingest and retrieval on its collection with it.
    """
    seen: set[tuple[object, object, object, object]] = set()
    unique: list[dict[str, Any]] = []
    for edge in edges:
        key = (
            edge.get("source"),
            edge.get("source_port"),
            edge.get("target"),
            edge.get("target_port"),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(edge)
    return unique


def _rename_ports(edges: list[dict[str, Any]], types: dict[str | None, str | None]) -> None:
    """Move edge port keys onto the items plane, per the nodes they join."""
    for edge in edges:
        source_type = types.get(edge.get("source"))
        if source_type in _OUTPUT_PORTS:
            edge["source_port"] = _OUTPUT_PORTS[source_type]
        target_type = types.get(edge.get("target"))
        if (
            isinstance(target_type, str)
            and target_type.startswith(CHUNKER_PREFIX)
            and edge.get("target_port") == "document"
        ):
            edge["target_port"] = "items"


def migrate_intake_nodes(session: Session) -> None:
    """Rewrite every stored pipeline version and commit changed definitions."""
    changed = False
    for version in PipelineVersionRepository(session).list_all():
        migrated = migrate_intake_definition(version.definition)
        if migrated == version.definition:
            continue
        version.definition = migrated
        session.add(version)
        changed = True
    if changed:
        session.commit()
