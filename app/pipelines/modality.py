"""Modality analysis over a pipeline graph.

Two questions have unambiguous answers in any graph shape, and this module
answers only those two:

- **Dead node**: a node whose `accepts` cannot intersect anything that can
  reach it processes nothing, whatever the rest of the graph does.
- **Lost modality**: items of a modality a node produces reach no sink
  that accepts them, so nothing indexes them.

Everything between — a node accepting part of what arrives while another
branch handles the rest — is how typed dataflow with several branches
normally runs. Intent is not inferable there (in some graph every
combination is deliberate), so it is rendered as structure in the editor
and never carries a severity.

Both checks are local in meaning even though they are computed over the
whole graph: reachability is a property of one producer port and
dead-node is a property of one node. Neither says anything about a
sibling branch, so no fan-out shape can create an ambiguity about which
branch was "supposed" to handle a modality.

Mirrored in `frontend/src/components/pipelines/lib/facet-inference.ts`
and pinned by `tests/assets/facet_vectors.json`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from app.pipelines.facets import EdgeRef, NodePorts, infer_port_facets
from app.pipelines.ports import CONTENT_MODALITIES, NodePort, PortKind


@dataclass(frozen=True)
class ModalityIssue:
    """One node that can process nothing, or one modality nothing indexes.

    A dead sink is an error, not a warning: a node that drops what it does
    not accept and can accept nothing emits an empty stream, so the branch
    indexes nothing at all. A dead transform only forwards its input
    untouched, and a lost modality costs the items of that one modality —
    both leave a working pipeline, so both warn.
    """

    kind: str
    node_id: str
    modality: str
    port_key: str
    severity: str = "warning"
    #: What the message calls the node — its label in the editor, falling
    #: back to its id. A finding naming a node UUID is unreadable next to
    #: a canvas where every node shows a name.
    node_label: str = ""

    @property
    def message(self) -> str:
        """Human-readable validation message for this issue."""
        name = self.node_label or self.node_id
        if self.kind == "dead_node":
            return (
                f"Node '{name}' processes {self.modality} items, but no "
                f"{self.modality} items can reach it."
            )
        return (
            f"{self.modality.capitalize()} items produced by node '{name}' "
            "reach no node that accepts them."
        )


def modality_issues(
    node_ports: NodePorts,
    edges: Sequence[EdgeRef],
    labels: Mapping[str, str] | None = None,
) -> list[ModalityIssue]:
    """Return every dead-node and lost-modality finding in a graph."""
    potentials = infer_port_facets(node_ports, edges).potentials
    outgoing = _outgoing(node_ports, edges)
    inbound_potential = _inbound_potential(node_ports, edges, potentials)
    issues = _dead_nodes(node_ports, inbound_potential)
    if _has_sink(node_ports):
        issues.extend(_lost_modalities(node_ports, outgoing, potentials))
    if labels is None:
        return issues
    return [
        replace(issue, node_label=labels.get(issue.node_id, issue.node_id)) for issue in issues
    ]


def _has_sink(node_ports: NodePorts) -> bool:
    """True when some node in this graph consumes items into a store.

    A graph with no sink is not in the business of indexing — a retrieval
    pipeline ends at its terminal — so asking whether its modalities reach
    an index has no meaningful answer, and asking anyway would warn about
    every retrieval pipeline in the app.
    """
    return any(
        port.data_type == PortKind.ITEMS and port.accepts and port.unaccepted == "exclude"
        for inputs, _outputs in node_ports.values()
        for port in inputs
    )


def _dead_nodes(
    node_ports: NodePorts, inbound_potential: Mapping[tuple[str, str], frozenset[str]]
) -> list[ModalityIssue]:
    """Find nodes whose accepts cannot intersect anything reaching them."""
    issues: list[ModalityIssue] = []
    for node_id, (inputs, _outputs) in node_ports.items():
        for port in inputs:
            if port.data_type != PortKind.ITEMS or not port.accepts:
                continue
            arriving = inbound_potential.get((node_id, port.key))
            if arriving is None or not arriving:
                continue  # nothing wired in — a draft, not a dead node
            if arriving & frozenset(port.accepts):
                continue
            issues.append(
                ModalityIssue(
                    kind="dead_node",
                    node_id=node_id,
                    modality=", ".join(sorted(port.accepts)),
                    port_key=port.key,
                    severity="error" if port.unaccepted == "exclude" else "warning",
                )
            )
    return issues


def _lost_modalities(
    node_ports: NodePorts,
    outgoing: Mapping[str, list[EdgeRef]],
    potentials: Mapping[tuple[str, str], frozenset[str]],
) -> list[ModalityIssue]:
    """Find content modalities a node introduces that reach no sink.

    A producer is a port that *adds* the modality — a chunker for text, an
    extractor for images, a describe shell for the text it writes onto an
    image. A port that merely forwards what arrived is not a producer:
    those items were already somebody else's to account for, and counting
    them again reports every node downstream of a real loss.
    """
    issues: list[ModalityIssue] = []
    for node_id, (_inputs, outputs) in node_ports.items():
        for port in outputs:
            if port.data_type != PortKind.ITEMS:
                continue
            produced = potentials.get((node_id, port.key), frozenset())
            for modality in sorted(frozenset(port.adds) & CONTENT_MODALITIES):
                carried = frozenset(produced & _DERIVED_AT_SOURCE) | {modality}
                if _reaches_sink(node_id, port.key, carried, node_ports, outgoing):
                    continue
                issues.append(
                    ModalityIssue(
                        kind="lost_modality",
                        node_id=node_id,
                        modality=modality,
                        port_key=port.key,
                    )
                )
    return issues


#: Facets an item can already carry when it leaves a producer, beyond the
#: modality being traced. Carrying them forward matters because a sink
#: accepts on them (a dense indexer takes anything embedded).
_DERIVED_AT_SOURCE: frozenset[str] = frozenset({"embedding", "score"})


def _reaches_sink(
    node_id: str,
    port_key: str,
    carried: frozenset[str],
    node_ports: NodePorts,
    outgoing: Mapping[str, list[EdgeRef]],
) -> bool:
    """Walk one modality forward and report whether a node takes it.

    The walked set evolves: the `adds` of the output ports an accepting
    node forwards on join it, which is how an image item becomes embedded
    and therefore acceptable to a dense indexer downstream. Only
    *preserving* outputs continue the walk — a node emitting new items (a
    retriever) honestly ends this item's journey, the same rule the
    chunk-reach walk follows.

    Two acceptances end the walk successfully, and both mean a node took
    responsibility for the item: an items input that *excludes* what it
    does not accept (an indexer), and an accepting node that emits items
    on some output port with none of them preserving, which consumes the
    item and emits something else in its place (a parse node turning a
    file into text, a retriever replacing a query with matches).

    A node whose outputs carry no items plane at all reports rather than
    consumes — the ingestion output emitting a `result`, a count node
    emitting `structured_values` — so the walk ends there without
    success. Counting a terminal as consumption makes the check vacuous:
    every branch reaches the output.
    """
    seen: set[tuple[str, str, frozenset[str]]] = set()
    frontier = [(node_id, port_key, carried)]
    while frontier:
        source, source_port, facets = frontier.pop()
        state = (source, source_port, facets)
        if state in seen:
            continue
        seen.add(state)
        for edge in outgoing.get(source, ()):
            if edge.source_port not in (None, source_port):
                continue
            target_ports = node_ports.get(edge.target)
            if target_ports is None:
                continue
            inputs, outputs = target_ports
            port = _input_port(inputs, edge.target_port)
            if port is None or port.data_type != PortKind.ITEMS:
                continue
            accepted = not port.accepts or bool(facets & frozenset(port.accepts))
            if port.unaccepted == "exclude":
                if accepted:
                    return True  # an index took it
                continue  # excluded here; this path ends
            items_outputs = [out for out in outputs if out.data_type == PortKind.ITEMS]
            forwarding = [out for out in items_outputs if out.preserves]
            if accepted and items_outputs and not forwarding:
                return True  # consumed here, replaced by what the node emits
            frontier.extend(
                (edge.target, out.key, facets | frozenset(out.adds) if accepted else facets)
                for out in forwarding
            )
    return False


def _input_port(inputs: Sequence[NodePort], key: str | None) -> NodePort | None:
    """Return the named input port, or the only one when the edge names none."""
    if key is None:
        return inputs[0] if len(inputs) == 1 else None
    return next((port for port in inputs if port.key == key), None)


def _outgoing(node_ports: NodePorts, edges: Sequence[EdgeRef]) -> dict[str, list[EdgeRef]]:
    """Index edges by their source node, skipping edges naming unknown nodes."""
    outgoing: dict[str, list[EdgeRef]] = {node_id: [] for node_id in node_ports}
    for edge in edges:
        if edge.source in node_ports and edge.target in node_ports:
            outgoing[edge.source].append(edge)
    return outgoing


def _inbound_potential(
    node_ports: NodePorts,
    edges: Sequence[EdgeRef],
    potentials: Mapping[tuple[str, str], frozenset[str]],
) -> dict[tuple[str, str], frozenset[str]]:
    """Union what may arrive on each items input port."""
    arriving: dict[tuple[str, str], frozenset[str]] = {}
    for edge in edges:
        target_ports = node_ports.get(edge.target)
        source_ports = node_ports.get(edge.source)
        if target_ports is None or source_ports is None:
            continue
        port = _input_port(target_ports[0], edge.target_port)
        if port is None or port.data_type != PortKind.ITEMS:
            continue
        source_port = _input_port(source_ports[1], edge.source_port)
        if source_port is None:
            continue
        key = (edge.target, port.key)
        arriving[key] = arriving.get(key, frozenset()) | potentials.get(
            (edge.source, source_port.key), frozenset()
        )
    return arriving
