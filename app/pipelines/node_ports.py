"""Config-derived output ports: the ports a node has once it is configured.

Most nodes' ports are fixed by their class, so `NodeSpec.output_ports` is the
whole answer. A node whose fan-out the *user* defines — the router's named
branches — declares a `DynamicPortSpec` instead, naming the config list its
extra output ports come from. Every consumer that asks "what ports does this
node in this graph have" goes through `resolve_output_ports` here, so edge
validation, facet inference, and the editor's canvas cannot disagree about
which handles exist.

Derived ports come first and the class's own declared ports last: the
config-derived list is the node's primary fan-out, and a fixed fallback port
(the router's unmatched branch) reads as the case left over after them.

A derived port's key is built from a stable entry *id*, never its name, so
renaming a branch keeps every edge already wired to it — a name-derived key
silently disconnects the graph the moment a user relabels a branch.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.pipelines.ports import NodePort

if TYPE_CHECKING:
    # Deferred: `node.py` builds a `NodeSpec` carrying a `DynamicPortSpec`
    # declared here, so a real import would cycle.
    from app.pipelines.definition import PipelineNodeDefinition

#: Separator between a dynamic port's prefix and the config entry id it
#: derives from. A key built this way can never collide with a declared
#: port key, which is a plain identifier.
DYNAMIC_PORT_SEPARATOR = ":"


class DynamicPortSpec(BaseModel):
    """How a node's config list becomes extra output ports.

    `config_field` names a list of objects on the node's config; each entry
    contributes one output port keyed `{key_prefix}:{entry[id_field]}` and
    labelled with `entry[label_field]`. `template` carries the facet
    declarations every derived port shares — they all describe the same
    stream, differing only in which items reach them.

    The whole shape is data rather than node-specific code so the editor
    mirrors one rule (`frontend/src/components/pipelines/lib/dynamic-ports.ts`)
    instead of one rule per node: a second node with user-defined ports costs
    no frontend change.
    """

    config_field: str
    id_field: str = "id"
    label_field: str = "name"
    key_prefix: str
    template: NodePort


def dynamic_port_key(prefix: str, entry_id: str) -> str:
    """Return the output-port key one config entry contributes."""
    return f"{prefix}{DYNAMIC_PORT_SEPARATOR}{entry_id}"


def derived_output_ports(
    spec: DynamicPortSpec | None,
    config: dict[str, object] | None,
) -> list[NodePort]:
    """Return the output ports this config contributes, in config order.

    Reads the raw config rather than a validated model because it runs on
    definitions the editor is still editing: a half-typed branch must still
    show its handle, and an entry with no id or a blank label contributes
    nothing rather than an unaddressable port.
    """
    if spec is None:
        return []
    entries = (config or {}).get(spec.config_field)
    if not isinstance(entries, list):
        return []
    ports: list[NodePort] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        entry_id = entry.get(spec.id_field)
        if not isinstance(entry_id, str) or not entry_id or entry_id in seen:
            continue
        seen.add(entry_id)
        label = entry.get(spec.label_field)
        ports.append(
            spec.template.model_copy(
                update={
                    "key": dynamic_port_key(spec.key_prefix, entry_id),
                    "label": label if isinstance(label, str) and label.strip() else entry_id,
                }
            )
        )
    return ports


def resolve_output_ports(
    declared: Sequence[NodePort],
    dynamic: DynamicPortSpec | None,
    node: PipelineNodeDefinition,
) -> list[NodePort]:
    """Return the output ports this node has, given the config it carries.

    Takes the two declarations rather than their carrier because callers
    hold different ones: a `NodeSpec` where the wire shape is what matters,
    the node class itself where a spec is not buildable (`spec()` also
    enforces the catalog copy every node owes, which a test double has no
    reason to write).
    """
    return [*derived_output_ports(dynamic, node.config), *declared]
