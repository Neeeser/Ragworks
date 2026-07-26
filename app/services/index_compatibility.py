"""Whether the indexes a binding selects fit the nodes that read them.

Because a binding may point a pipeline at an index on a different backend,
"is this graph valid?" stops being a property of the definition alone. A
pipeline holding a `facet.bm25` node is fine on ParadeDB and impossible on
Pinecone, so the check runs against the resolved `(node, backend)` pairs of
one binding, and reports *which* nodes are the problem — "incompatible
backend" without naming them leaves the user to guess which of a dozen nodes
to remove.

The findings are plain data so every surface renders the same answer: binding
create/update rejects them, the pipeline validator shows them per node, and
collection diagnostics reports them for bindings that already exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.pipelines.definition import PipelineDefinition
from app.pipelines.expressions import ExpressionError, parse, references
from app.pipelines.index_variables import is_lexical_node
from app.pipelines.node import PipelineNodeBase
from app.pipelines.nodes.indexing import BaseIndexerNode
from app.pipelines.nodes.retrieval import BaseRetrieverNode
from app.pipelines.registry import NodeRegistry
from app.pipelines.variables import expression_source
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


def index_variable_vector_types(definition: PipelineDefinition) -> dict[str, str]:
    """Return `{index variable: "dense" | "sparse"}` from how each is used.

    Read from the nodes that reference the variable, never from its name: a
    variable called `secondary_index` feeding a BM25 retriever needs a sparse
    index, and inferring that from spelling would silently mispick whenever
    an author names a variable differently.
    """
    wanted: dict[str, str] = {}
    for node in definition.nodes:
        vector_type = "sparse" if is_lexical_node(node.type) else "dense"
        for value in (node.config or {}).values():
            source = expression_source(value)
            if source is None:
                continue
            try:
                names = references(parse(source))
            except ExpressionError:
                continue
            for name in names:
                # Sparse wins a tie: an index feeding any lexical node must be
                # sparse, whatever else reads it.
                if vector_type == "sparse" or name not in wanted:
                    wanted[name] = vector_type
    return wanted
