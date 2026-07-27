"""Whether a graph's nodes can run on the backends its indexes are on.

A pipeline holding a `facet.bm25` node is fine on ParadeDB and impossible on
Pinecone. Because a node names its own index, that is a property of the
definition alone — the same answer for every collection that binds it — so
the check runs at save time and the findings name *which* nodes are the
problem: "incompatible backend" without naming them leaves the user to guess
which of a dozen nodes to change.

The findings are plain data so every surface renders the same answer: the
validator shows them per node, and collection diagnostics reports them for
pipelines already bound.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.pipelines.definition import PipelineDefinition
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.indexing import BaseIndexerNode
from app.pipelines.nodes.retrieval import BaseRetrieverNode
from app.pipelines.registry import NodeRegistry
from app.schemas.enums import IndexBackend


@dataclass(frozen=True)
class IncompatibleNode:
    """One node that cannot run against the backend it resolved to."""

    node_id: str
    node_type: str
    backend: IndexBackend
    supported: tuple[IndexBackend, ...]

    @property
    def message(self) -> str:
        """A sentence naming the node, the backend, and what would work."""
        supported = ", ".join(backend.value for backend in self.supported) or "no backend"
        return (
            f"Node '{self.node_id}' ({self.node_type}) does not run on "
            f"{self.backend.value}; it requires {supported}."
        )


def resolved_backend(
    node_cls: type[PipelineNodeBase[Any]],
    config: dict[str, object],
) -> IndexBackend | None:
    """Return the backend a store-bound node resolved to, else None.

    Reads through the node's own config model rather than the raw dict, so a
    node whose config shape changes cannot silently diverge from runtime.
    """
    if issubclass(node_cls, BaseIndexerNode):
        return node_cls.resolve_backend(node_cls.config_model.model_validate(config or {}))
    if issubclass(node_cls, BaseRetrieverNode):
        return node_cls.resolve_backend(node_cls.config_model.model_validate(config or {}))
    backends = node_cls.supported_backends()
    if backends is None:
        return None
    raw = (config or {}).get("backend")
    if isinstance(raw, str):
        try:
            return IndexBackend(raw)
        except ValueError:
            return None
    return None


def incompatible_nodes(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> list[IncompatibleNode]:
    """Return every node whose resolved backend it does not support.

    The definition must already be *resolved* (expressions replaced with
    literals) — checking a raw definition would compare against `{"$expr":
    ...}` and pass everything.
    """
    findings: list[IncompatibleNode] = []
    for node in definition.nodes:
        node_cls = registry.get_node_class(node.type)
        if node_cls is None:
            continue
        supported = node_cls.supported_backends()
        if supported is None:
            continue
        backend = resolved_backend(node_cls, dict(node.config))
        if backend is None or backend in supported:
            continue
        findings.append(
            IncompatibleNode(
                node_id=node.id,
                node_type=node.type,
                backend=backend,
                supported=tuple(supported),
            )
        )
    return findings


def backend_support_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Project the findings onto per-node validation issues.

    Reported when the pipeline is saved, because the index a node uses is
    named in the graph: a facet node pointed at Pinecone is wrong for
    everyone, not for one collection.
    """
    return [
        PipelineValidationIssue(
            code="backend_unsupported",
            message=finding.message,
            node_id=finding.node_id,
        )
        for finding in incompatible_nodes(definition, registry)
    ]
