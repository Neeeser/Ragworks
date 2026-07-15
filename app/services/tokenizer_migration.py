"""Startup migration from tokenizer resource nodes to chunker config fields."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlmodel import Session

from app.db.repositories import PipelineVersionRepository

TOKENIZER_PREFIX = "tokenizer."
CHUNKER_PREFIX = "chunker."


def migrate_tokenizer_definition(definition: dict[str, Any]) -> dict[str, Any]:
    """Fold wired tokenizer nodes into chunker configs and remove their layout."""
    migrated = deepcopy(definition)
    nodes = migrated.get("nodes", [])
    edges = migrated.get("edges", [])
    tokenizer_nodes = {
        node.get("id"): node
        for node in nodes
        if isinstance(node.get("type"), str)
        and node["type"].startswith(TOKENIZER_PREFIX)
    }
    if not tokenizer_nodes:
        return migrated

    node_map = {node.get("id"): node for node in nodes}
    for edge in edges:
        source = tokenizer_nodes.get(edge.get("source"))
        target = node_map.get(edge.get("target"))
        if source is None or target is None:
            continue
        if edge.get("source_port") != "tokenizer" or edge.get("target_port") != "tokenizer":
            continue
        target_type = target.get("type")
        if not isinstance(target_type, str) or not target_type.startswith(CHUNKER_PREFIX):
            continue
        kind = source["type"].removeprefix(TOKENIZER_PREFIX)
        config = dict(target.get("config") or {})
        config["tokenizer"] = kind
        if kind == "huggingface":
            model_id = (source.get("config") or {}).get("hf_model_id")
            if model_id is not None:
                config["hf_model_id"] = model_id
        else:
            config.pop("hf_model_id", None)
        target["config"] = config

    tokenizer_ids = set(tokenizer_nodes)
    migrated["nodes"] = [node for node in nodes if node.get("id") not in tokenizer_ids]
    migrated["edges"] = [
        edge
        for edge in edges
        if edge.get("source") not in tokenizer_ids and edge.get("target") not in tokenizer_ids
    ]
    return migrated


def migrate_tokenizer_nodes(session: Session) -> None:
    """Rewrite every stored pipeline version and commit changed definitions."""
    changed = False
    for version in PipelineVersionRepository(session).list_all():
        migrated = migrate_tokenizer_definition(version.definition)
        if migrated == version.definition:
            continue
        version.definition = migrated
        session.add(version)
        changed = True
    if changed:
        session.commit()
