"""Resolve each model-backed node's real modality contract, and check it.

A node whose port says it processes images is only as good as the model
behind it, and a node whose port is a floor is only as narrow as its model
is. Both facts are known while the pipeline is being edited — the node
declares its rule (`ModelModalityRule`), the provider's catalog states
what the model reads — so both land at save time:

- A node with a **fixed** contract whose model cannot read what it
  processes is an error. Left to run time it is a provider 400 naming a
  request field rather than the choice that caused it.
- A node whose contract **follows its model** gets its `accepts` widened
  here, so the graph analysis downstream (`app/pipelines/modality.py`)
  asks its questions against what the pipeline will actually do. Without
  this, picking a multimodal embedding model would still report the
  images as reaching no index.

A provider that publishes no modality list says nothing rather than "text
only", and every check stays silent — refusing a model because its
provider publishes no modality block would make most providers unusable
for images.

Lives at the definition level, like `embedding_dimensions.py`, because the
per-node validation hook is given no provider resolvers.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from pydantic import BaseModel, ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.model_modality import FACET_BY_MODALITY, ModelModalityRule
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.registry import NodeRegistry
from app.schemas.enums import ProviderKind

#: Returns the input modalities a connection's catalog publishes for a
#: model, or an empty set when it publishes none.
ModalityResolver = Callable[[UUID, str, ProviderKind], frozenset[str]]

#: Per-node overrides of an items input port's `accepts`, keyed by
#: `(node_id, port_key)` — what the graph analysis reads instead of the
#: class declaration.
AcceptsOverrides = dict[tuple[str, str], frozenset[str]]


class _ModelSelection(BaseModel):
    """The (connection, model) pair every model-backed node config carries."""

    connection_id: UUID | None = None
    model_name: str = ""


def resolve_model_modalities(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    resolver: ModalityResolver | None,
) -> tuple[list[PipelineValidationIssue], AcceptsOverrides]:
    """Return modality findings and the accepts overrides they imply."""
    issues: list[PipelineValidationIssue] = []
    overrides: AcceptsOverrides = {}
    if resolver is None:
        return (issues, overrides)
    for node in definition.nodes:
        node_class = registry.get_node_class(node.type)
        rule = node_class.model_modality if node_class is not None else None
        if node_class is None or rule is None:
            continue
        selection = _selection(node.config or {})
        if selection is None:
            continue  # an incomplete draft — the node's own hook reports it
        connection_id, model_name = selection
        readable = _readable_facets(resolver(connection_id, model_name, rule.kind))
        if readable is None:
            continue  # the provider states nothing; a mismatch would be a guess
        for port in node_class.input_ports:
            if port.data_type != PortKind.ITEMS or not port.accepts:
                continue
            self_issue, override = _for_port(node, port, rule, readable, model_name, node_class)
            if self_issue is not None:
                issues.append(self_issue)
            if override is not None:
                overrides[node.id, port.key] = override
    return (issues, overrides)


def _for_port(
    node: PipelineNodeDefinition,
    port: NodePort,
    rule: ModelModalityRule,
    readable: frozenset[str],
    model_name: str,
    node_class: type,
) -> tuple[PipelineValidationIssue | None, frozenset[str] | None]:
    """Apply one node's rule to one of its items input ports."""
    declared = frozenset(port.accepts)
    if rule.follows_model:
        return (None, declared | readable)
    # Text is every model's baseline, so only modalities beyond it can
    # disqualify a selection.
    missing = sorted(declared - readable - {Facet.TEXT})
    if not missing:
        return (None, None)
    modalities = ", ".join(missing)
    label = getattr(node_class, "label", node.type)
    return (
        PipelineValidationIssue(
            message=(
                f"{label} node '{node.id}' processes {modalities} items, but "
                f"'{model_name}' does not accept {modalities} input. Pick a "
                "model that does."
            ),
            severity="error",
            node_id=node.id,
            field="model_name",
            model=model_name,
        ),
        None,
    )


def _readable_facets(published: frozenset[str]) -> frozenset[str] | None:
    """Map published modality names onto facets; None when nothing is published."""
    if not published:
        return None
    return frozenset(
        FACET_BY_MODALITY[name] for name in published if name in FACET_BY_MODALITY
    )


def _selection(config: dict[str, object]) -> tuple[UUID, str] | None:
    """Read a node config's model identity, ignoring everything else.

    Every model-backed node names its model the same way, so this reads
    that pair rather than each node's full config model — a node whose
    other fields are mid-edit still has a resolvable selection.
    """
    try:
        parsed = _ModelSelection.model_validate(config)
    except ValidationError:
        return None
    if parsed.connection_id is None or not parsed.model_name:
        return None
    return (parsed.connection_id, parsed.model_name)
