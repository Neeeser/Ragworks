"""Facet inference over a pipeline graph.

Facets (see `app/pipelines/ports.py`) are per-item guarantees carried by
`items` streams. A port's *effective* guarantees depend on everything
upstream of it — a preserving node (embedder, indexer, limit) forwards
whatever its input guaranteed — so facet compatibility is a graph property,
not a pairwise port check. This module owns that inference, as pure
functions over port declarations and edges.

The same algorithm is mirrored in
`frontend/src/components/pipelines/lib/facet-inference.ts` for live editor
feedback; the shared vectors in `tests/assets/facet_vectors.json` pin both
implementations — a semantics change lands in both plus the vectors, never
one side.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.pipelines.ports import NodePort, PortKind


@dataclass(frozen=True)
class EdgeRef:
    """One directed connection between two node ports."""

    id: str
    source: str
    source_port: str | None
    target: str
    target_port: str | None


@dataclass(frozen=True)
class FacetIssue:
    """One edge delivering items without a facet its target requires."""

    edge_id: str
    source: str
    target: str
    target_port: str
    missing: tuple[str, ...]

    @property
    def message(self) -> str:
        """Human-readable validation message for this issue."""
        missing = ", ".join(self.missing)
        return (
            f"Edge '{self.edge_id}' delivers items without {missing} — "
            f"required by input '{self.target_port}' on node '{self.target}'."
        )


NodePorts = Mapping[str, tuple[Sequence[NodePort], Sequence[NodePort]]]
PortFacets = dict[tuple[str, str], frozenset[str]]


@dataclass(frozen=True)
class InferredFacets:
    """Both bounds on what each items output port carries.

    `guarantees` is what every item has (the `requires` check reads it);
    `potentials` is what any item might have (modality analysis reads it).
    """

    guarantees: PortFacets
    potentials: PortFacets


def _port(ports: Sequence[NodePort], key: str | None) -> NodePort | None:
    """Return the port with `key`, or the only port when key is None."""
    if key is None:
        return ports[0] if len(ports) == 1 else None
    return next((port for port in ports if port.key == key), None)


def infer_output_facets(node_ports: NodePorts, edges: Sequence[EdgeRef]) -> PortFacets:
    """Return guaranteed facets per `(node_id, output_port_key)`."""
    return infer_port_facets(node_ports, edges).guarantees


def infer_port_facets(node_ports: NodePorts, edges: Sequence[EdgeRef]) -> InferredFacets:
    """Infer both bounds on what every items output port carries.

    Guarantees are the lower bound — every item carries these — and drive
    the hard `requires` check. Potentials are the upper bound: what items
    in this stream *may* carry, which is what modality analysis needs,
    since a node that processes part of a stream and forwards the rest
    produces items of more than one shape.

    Both propagate in topological order. A preserving output carries the
    intersection of arriving guarantees (union, for potentials) plus its
    own `adds`, and a non-preserving output starts fresh from `adds`. A
    node's `adds` only counts toward *guarantees* when nothing in the
    arriving stream can bypass it: an item the node does not accept comes
    out the other side untouched, so claiming the added facet for the
    whole stream would be false. Nodes on a cycle (which validation
    rejects separately) and edges referencing unknown nodes/ports are
    skipped — inference never raises on a malformed graph, it just leaves
    those ports unresolved.
    """
    indegree: dict[str, int] = dict.fromkeys(node_ports, 0)
    outgoing: dict[str, list[EdgeRef]] = {node_id: [] for node_id in node_ports}
    incoming: dict[str, list[EdgeRef]] = {node_id: [] for node_id in node_ports}
    for edge in edges:
        if edge.source not in node_ports or edge.target not in node_ports:
            continue
        outgoing[edge.source].append(edge)
        incoming[edge.target].append(edge)
        indegree[edge.target] += 1

    guarantees: PortFacets = {}
    potentials: PortFacets = {}
    ready = [node_id for node_id, degree in indegree.items() if degree == 0]
    while ready:
        node_id = ready.pop()
        inputs, outputs = node_ports[node_id]
        arriving = _arriving_facets(inputs, incoming[node_id], node_ports, guarantees)
        arriving_potential = _arriving_potential(inputs, incoming[node_id], node_ports, potentials)
        for port in outputs:
            if port.data_type != PortKind.ITEMS:
                continue
            guarantees[node_id, port.key] = _output_guarantees(port, inputs, arriving)
            potentials[node_id, port.key] = _output_potential(port, inputs, arriving_potential)
        for edge in outgoing[node_id]:
            indegree[edge.target] -= 1
            if indegree[edge.target] == 0:
                ready.append(edge.target)
    return InferredFacets(guarantees=guarantees, potentials=potentials)


def _output_guarantees(
    port: NodePort,
    inputs: Sequence[NodePort],
    arriving: frozenset[str] | None,
) -> frozenset[str]:
    """Guarantees for one output port: preserved facets plus honest adds."""
    guarantees: frozenset[str] = frozenset()
    if _adds_reach_everything(inputs, arriving):
        guarantees = frozenset(port.adds)
    if port.preserves and arriving is not None:
        guarantees |= arriving
    return guarantees


def _output_potential(
    port: NodePort, inputs: Sequence[NodePort], arriving_potential: frozenset[str]
) -> frozenset[str]:
    """Potential for one output port: adds, plus whatever can flow through.

    A preserving output forwards its input's potential. So does a
    non-preserving one whose node lets unaccepted items pass: those items
    are the node's input stream, unchanged, leaving on the same port.
    """
    potential = frozenset(port.adds)
    if port.preserves or _passes_through(inputs):
        potential |= arriving_potential
    return potential


def _adds_reach_everything(inputs: Sequence[NodePort], arriving: frozenset[str] | None) -> bool:
    """True when no arriving item can bypass this node's processing.

    An item is processed when it carries any facet the port accepts, so
    the whole stream is processed exactly when the arriving *guarantee*
    already includes one — a guarantee holds for every item, which is the
    only thing that rules a bypass out. Potentials cannot answer this:
    they say a facet may appear, not that it always does. With nothing
    arriving there is nothing to bypass, and a source node's adds stand.
    """
    restricted = [
        port
        for port in inputs
        if port.data_type == PortKind.ITEMS and port.accepts and port.unaccepted == "passthrough"
    ]
    if not restricted or arriving is None:
        return True
    return all(bool(arriving & frozenset(port.accepts)) for port in restricted)


def _passes_through(inputs: Sequence[NodePort]) -> bool:
    """True when the node forwards items it does not itself process."""
    return any(
        port.data_type == PortKind.ITEMS and port.accepts and port.unaccepted == "passthrough"
        for port in inputs
    )


def _arriving_facets(
    inputs: Sequence[NodePort],
    inbound: Sequence[EdgeRef],
    node_ports: NodePorts,
    resolved: PortFacets,
) -> frozenset[str] | None:
    """Intersect the guarantees of every items stream arriving at a node.

    Returns None when no items edge arrives (a preserving output then
    guarantees only its `adds`). An arriving edge whose source port is
    unresolved contributes the empty set — guarantees never overclaim.
    """
    sets = _inbound_sets(inputs, inbound, node_ports, resolved)
    if not sets:
        return None
    intersection = sets[0]
    for facets in sets[1:]:
        intersection &= facets
    return intersection


def _arriving_potential(
    inputs: Sequence[NodePort],
    inbound: Sequence[EdgeRef],
    node_ports: NodePorts,
    potentials: PortFacets,
) -> frozenset[str]:
    """Union the potentials of every items stream arriving at a node.

    Union, where guarantees intersect: a facet one branch might carry is
    a facet this node might receive, which is exactly what an upper bound
    means.
    """
    return frozenset().union(*_inbound_sets(inputs, inbound, node_ports, potentials)) or frozenset()


def _inbound_sets(
    inputs: Sequence[NodePort],
    inbound: Sequence[EdgeRef],
    node_ports: NodePorts,
    resolved: PortFacets,
) -> list[frozenset[str]]:
    """Collect the resolved facet sets arriving on a node's items inputs."""
    sets: list[frozenset[str]] = []
    for edge in inbound:
        target_port = _port(inputs, edge.target_port)
        if target_port is None or target_port.data_type != PortKind.ITEMS:
            continue
        source_ports = node_ports.get(edge.source)
        source_port = _port(source_ports[1], edge.source_port) if source_ports else None
        if source_port is None or source_port.data_type != PortKind.ITEMS:
            sets.append(frozenset())
            continue
        sets.append(resolved.get((edge.source, source_port.key), frozenset()))
    return sets


def facet_issues(node_ports: NodePorts, edges: Sequence[EdgeRef]) -> list[FacetIssue]:
    """Return one issue per edge whose stream misses required facets."""
    resolved = infer_output_facets(node_ports, edges)
    issues: list[FacetIssue] = []
    for edge in edges:
        source_ports = node_ports.get(edge.source)
        target_ports = node_ports.get(edge.target)
        if source_ports is None or target_ports is None:
            continue
        source_port = _port(source_ports[1], edge.source_port)
        target_port = _port(target_ports[0], edge.target_port)
        if source_port is None or target_port is None:
            continue
        if target_port.data_type != PortKind.ITEMS or not target_port.requires:
            continue
        key = (edge.source, source_port.key)
        if key not in resolved:
            continue  # unresolved source (cycle) — reported elsewhere
        missing = tuple(sorted(frozenset(target_port.requires) - resolved[key]))
        if missing:
            issues.append(
                FacetIssue(
                    edge_id=edge.id,
                    source=edge.source,
                    target=edge.target,
                    target_port=target_port.key,
                    missing=missing,
                )
            )
    return issues
