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


def _port(ports: Sequence[NodePort], key: str | None) -> NodePort | None:
    """Return the port with `key`, or the only port when key is None."""
    if key is None:
        return ports[0] if len(ports) == 1 else None
    return next((port for port in ports if port.key == key), None)


def infer_output_facets(node_ports: NodePorts, edges: Sequence[EdgeRef]) -> PortFacets:
    """Return guaranteed facets per `(node_id, output_port_key)`.

    Guarantees propagate in topological order: a preserving output carries
    the intersection of the guarantees arriving at the node's `items`
    inputs, plus its own `adds`; a non-preserving output carries exactly
    `adds`. Nodes on a cycle (which validation rejects separately) and
    edges referencing unknown nodes/ports are skipped — inference never
    raises on a malformed graph, it just leaves those ports unresolved.
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

    resolved: PortFacets = {}
    ready = [node_id for node_id, degree in indegree.items() if degree == 0]
    while ready:
        node_id = ready.pop()
        inputs, outputs = node_ports[node_id]
        arriving = _arriving_facets(node_id, inputs, incoming[node_id], node_ports, resolved)
        for port in outputs:
            if port.data_type != PortKind.ITEMS:
                continue
            guarantees = frozenset(port.adds)
            if port.preserves and arriving is not None:
                guarantees |= arriving
            resolved[node_id, port.key] = guarantees
        for edge in outgoing[node_id]:
            indegree[edge.target] -= 1
            if indegree[edge.target] == 0:
                ready.append(edge.target)
    return resolved


def _arriving_facets(
    node_id: str,
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
    del node_id
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
    if not sets:
        return None
    intersection = sets[0]
    for facets in sets[1:]:
        intersection &= facets
    return intersection


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
