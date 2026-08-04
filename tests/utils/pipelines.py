"""Shaping test pipelines the way the editor shapes them.

A store-bound node names its index by default. Pointing one at a slot the
collection fills is a deliberate authoring step, so tests that exercise slots
build that shape explicitly rather than relying on scaffolding to produce it.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.index_identity import is_lexical_node, store_bound_node
from app.pipelines.registry import default_registry
from app.pipelines.variables import (
    EXPRESSION_KEY,
    PipelineVariable,
    VariableSource,
    VariableType,
)
from app.schemas.enums import IndexBackend

DENSE_SLOT = "primary_index"
SPARSE_SLOT = "bm25_index"

#: Query-input node type id (matches `app.pipelines.nodes.io.RetrievalInputNode.type`).
_QUERY_INPUT_NODE_TYPE = "retrieval.input"


def with_tool_name(definition: PipelineDefinition, tool_name: str) -> PipelineDefinition:
    """Return `definition` with its query-input node's `tool_name` overridden.

    The default retrieval/tool-defaults definitions all declare an explicit
    `tool_name` (`"search"`, `"count_documents"`, ...), so two pipelines built
    from the same template collide on that name unless a test gives one a
    distinct identity -- this is how tests do that without hand-building a
    whole definition.
    """
    nodes = [
        node.model_copy(update={"config": {**(node.config or {}), "tool_name": tool_name}})
        if node.type == _QUERY_INPUT_NODE_TYPE
        else node
        for node in definition.nodes
    ]
    return definition.model_copy(update={"nodes": nodes})


def expose_index_slots(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
) -> PipelineDefinition:
    """Point every store-bound node at a binding-filled index slot.

    The same edit the node editor writes: the node's identity fields become
    expressions over an index variable, and the variable defaults to the
    index the node already named, so nothing about what it resolves to
    changes until a collection chooses otherwise.
    """
    registry = default_registry()
    indexes = RegisteredIndexRepository(session)
    defaults: dict[str, tuple[UUID, models.RegisteredIndex]] = {}
    nodes = []
    for node in definition.nodes:
        config = dict(node.config or {})
        name = config.get("index_name")
        if not store_bound_node(node.type, registry) or not isinstance(name, str) or not name:
            nodes.append(node)
            continue
        sparse = is_lexical_node(node.type)
        slot = SPARSE_SLOT if sparse else DENSE_SLOT
        row = indexes.get_or_create(
            user.id,
            IndexBackend(config.get("backend", "pgvector")),
            name,
            vector_type="sparse" if sparse else "dense",
            dimension=None if sparse else config.get("dimension"),
            metric=None if sparse else config.get("metric"),
        )
        defaults[slot] = (row.id, row)
        config["index_name"] = {EXPRESSION_KEY: f"{slot}.name"}
        if "backend" in config:
            config["backend"] = {EXPRESSION_KEY: f"{slot}.backend"}
        nodes.append(node.model_copy(update={"config": config}))
    variables = [
        variable for variable in definition.variables if variable.name not in defaults
    ]
    for slot, (index_id, row) in defaults.items():
        variables.append(
            PipelineVariable(
                name=slot,
                type=VariableType.INDEX,
                source=VariableSource.BINDING,
                description=(
                    "Lexical (BM25) index this pipeline uses"
                    if slot == SPARSE_SLOT
                    else "Vector index this pipeline uses"
                ),
                value={
                    "index_id": str(index_id),
                    "backend": IndexBackend(row.backend).value,
                    "name": row.name,
                },
            )
        )
    session.commit()
    return definition.model_copy(update={"nodes": nodes, "variables": variables})
