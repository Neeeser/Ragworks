"""Follow a chunker's chunks forward to the embedders they reach.

Chunks are followed through the graph rather than across a single edge, along
`items` streams: the walk starts at each chunker's items outputs and continues
past an intermediate node only through outputs declaring `preserves` — the
port system's own statement that the node forwards the items it received — so
adding a forwarding node cannot silently switch a downstream check off, while
nodes that emit *new* items (retrievers) end the walk.

The walk also accounts for text a node on the path *writes into* the items
passing through it: a contextual-retrieval node prepends its answer to every
chunk, so what arrives at the embedder is the chunker's window plus everything
added on the way. A `replace` field goes further and *takes over* the window:
it discards the chunk, so from that node onward the chunker's size governs
nothing and what reaches the embedder is the node's own output.

Which of those a node's writes land on is decided by its input port's
`accepts`. A restricted port processes only the modalities it accepts and
passes everything else through untouched (`app/pipelines/partition.py`),
so a vision node accepting images alone writes onto the images the chunker
forwarded and onto no chunk at all — counting its budget against the
chunker's window would refuse a `chunk_size` that fits, on a field that
cannot fix it. Those writes are reported separately, as `unchunked`: they
still reach the embedder, and nothing but the writing nodes' own budgets
bounds them.

Either way the bound is the node's `max_output_tokens` — one call answers
every field, so its whole budget bounds everything the node writes. A node
writing text without one is reported as unbudgeted rather than counted as
zero, because a missing term silently turns an over-limit window into one
that looks fine.

`app/pipelines/embedding_limits.py` turns what this module finds into
findings addressed to the fields a user would change.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from pydantic import ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.llm.config import LlmNodeConfig, TextTarget
from app.pipelines.node_ports import resolve_output_ports
from app.pipelines.nodes.chunking import BaseChunkerNode
from app.pipelines.nodes.embedding import EmbedderNode
from app.pipelines.ports import Facet, PortKind
from app.pipelines.registry import NodeRegistry


@dataclass(frozen=True)
class TextGrowth:
    """What one node on the path writes into the text passing through it."""

    node_id: str
    #: Upper bound on the tokens this node writes into an item, separators
    #: included. Zero when the node declares no budget for them.
    written: int
    #: The node has a `replace` field, so `written` is the whole window after
    #: it rather than an increment on what arrived.
    replaces: bool
    #: The node writes into the text with no budget bounding how much.
    unbudgeted: bool


@dataclass(frozen=True)
class ChunkReach:
    """How one chunker's items arrive at one embedder."""

    hops: int
    #: Text written onto the chunks themselves, in path order.
    growth: tuple[TextGrowth, ...]
    #: Text written onto items on this path that the chunker never sized —
    #: a node whose `accepts` excludes text writes onto the items the
    #: chunker forwarded untouched. They reach the same embedder, bounded
    #: only by the writing node's own budget.
    unchunked: tuple[TextGrowth, ...] = ()


@dataclass(frozen=True)
class _Path:
    """What the walk has accumulated on the way to one node."""

    hops: int
    growth: tuple[TextGrowth, ...]
    unchunked: tuple[TextGrowth, ...]


@dataclass(frozen=True)
class _Graph:
    """The items-edge view of a definition that the walk runs over."""

    node_map: dict[str, PipelineNodeDefinition]
    origin: dict[str, list[str]]
    forward: dict[str, list[str]]
    registry: NodeRegistry


def separator_tokens(separator: str) -> int:
    """Estimate the tokens a join separator costs.

    Static validation has no tokenizer for text the model has not written
    yet, so this uses the conventional ~4-characters-per-token rule with a
    one-token floor: a separator is short, and dropping it entirely is the
    difference between a window that reports as fitting and one that does not.
    """
    if not separator:
        return 0
    return max(1, len(separator) // 4)


def text_growth(node: PipelineNodeDefinition, registry: NodeRegistry) -> TextGrowth | None:
    """Return what a node adds to an item's text, or None if it adds nothing.

    Read through the node's own config model rather than the raw dict, so
    this cannot drift from what the node actually runs with.
    """
    node_cls = registry.get_node_class(node.type)
    if node_cls is None or not issubclass(node_cls.config_model, LlmNodeConfig):
        return None
    try:
        config = node_cls.config_model.model_validate(node.config or {})
    except ValidationError:
        return None
    targets = [spec.target for spec in config.output_fields if isinstance(spec.target, TextTarget)]
    if not targets:
        return None
    replaces = any(target.mode == "replace" for target in targets)
    if config.max_output_tokens is None:
        return TextGrowth(node_id=node.id, written=0, replaces=replaces, unbudgeted=True)
    # One call answers every field, so the node's whole output budget bounds
    # what it writes however many fields write text. Only a prepend/append
    # joins onto the item with a separator; a replace drops what was there.
    written = config.max_output_tokens + sum(
        separator_tokens(target.separator) for target in targets if target.mode != "replace"
    )
    return TextGrowth(node_id=node.id, written=written, replaces=replaces, unbudgeted=False)


def writes_onto_chunks(node: PipelineNodeDefinition, registry: NodeRegistry) -> bool:
    """Whether what a node writes lands on the chunks passing through it.

    An items input port with a restricted `accepts` processes only those
    modalities and forwards the rest untouched, so a node accepting images
    alone never writes onto a text chunk. The port declarations are read
    exactly as `PipelineNodeBase.run` reads them when it partitions, so the
    static answer and the run cannot disagree.
    """
    node_cls = registry.get_node_class(node.type)
    if node_cls is None:
        return False
    return any(
        not port.accepts or Facet.TEXT in port.accepts
        for port in node_cls.input_ports
        if port.data_type == PortKind.ITEMS
    )


def _items_ports(
    node: PipelineNodeDefinition,
    registry: NodeRegistry,
    *,
    outgoing: bool,
    preserving_only: bool = False,
) -> set[str]:
    """Return the node's items-kind port keys, optionally only preserving outputs."""
    node_cls = registry.get_node_class(node.type)
    if node_cls is None:
        return set()
    # Config-derived outputs are ordinary items ports: leaving them out
    # would end the chunker's reach at a router and silently switch the
    # embedding-window check off for everything downstream of it.
    ports = (
        resolve_output_ports(node_cls.output_ports, node_cls.dynamic_output_ports, node)
        if outgoing
        else list(node_cls.input_ports)
    )
    return {
        port.key
        for port in ports
        if port.data_type == PortKind.ITEMS and (not preserving_only or port.preserves)
    }


def _items_adjacency(
    definition: PipelineDefinition, registry: NodeRegistry
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Return (all items edges, items edges leaving preserving outputs) by source."""
    node_map = definition.node_map()
    origin: dict[str, list[str]] = {}
    forward: dict[str, list[str]] = {}
    for edge in definition.edges:
        source = node_map.get(edge.source)
        target = node_map.get(edge.target)
        if source is None or target is None:
            continue
        if edge.target_port not in _items_ports(target, registry, outgoing=False):
            continue
        if edge.source_port in _items_ports(source, registry, outgoing=True):
            origin.setdefault(edge.source, []).append(edge.target)
        if edge.source_port in _items_ports(source, registry, outgoing=True, preserving_only=True):
            forward.setdefault(edge.source, []).append(edge.target)
    return origin, forward


def chunk_reach(
    definition: PipelineDefinition, registry: NodeRegistry
) -> dict[str, dict[str, ChunkReach]]:
    """Map each chunker to the embedders it reaches and what it picks up en route."""
    origin_adjacency, forward_adjacency = _items_adjacency(definition, registry)
    graph = _Graph(
        node_map=definition.node_map(),
        origin=origin_adjacency,
        forward=forward_adjacency,
        registry=registry,
    )

    reach: dict[str, dict[str, ChunkReach]] = {}
    for node in definition.nodes:
        node_cls = registry.get_node_class(node.type)
        if node_cls is None or not issubclass(node_cls, BaseChunkerNode):
            continue
        found = _walk_from_chunker(node.id, graph)
        if found:
            reach[node.id] = found
    return reach


def _walk_from_chunker(chunker_id: str, graph: _Graph) -> dict[str, ChunkReach]:
    """Follow one chunker's items to every embedder they can reach.

    Breadth-first, so the recorded path is the shortest: a chunker wired both
    directly and through another node is judged on the direct feed. Each node
    passed through contributes whatever it writes into the items' text.
    """
    found: dict[str, ChunkReach] = {}
    seen = {chunker_id}
    start = _Path(hops=1, growth=(), unchunked=())
    queue: deque[tuple[str, _Path]] = deque(
        (target, start) for target in graph.origin.get(chunker_id, [])
    )
    while queue:
        current, path = queue.popleft()
        if current in seen:
            continue
        seen.add(current)
        node = graph.node_map[current]
        if node.type == EmbedderNode.type:
            found[current] = ChunkReach(
                hops=path.hops, growth=path.growth, unchunked=path.unchunked
            )
            # An embedder consumes the chunks' text; nothing continues past it.
            continue
        onward = _extend(path, node, graph)
        queue.extend((target, onward) for target in graph.forward.get(current, []))
    return found


def _extend(path: _Path, node: PipelineNodeDefinition, graph: _Graph) -> _Path:
    """Carry the path one hop further, recording what this node writes."""
    added = text_growth(node, graph.registry)
    if added is None:
        return _Path(hops=path.hops + 1, growth=path.growth, unchunked=path.unchunked)
    if writes_onto_chunks(node, graph.registry):
        return _Path(hops=path.hops + 1, growth=(*path.growth, added), unchunked=path.unchunked)
    return _Path(hops=path.hops + 1, growth=path.growth, unchunked=(*path.unchunked, added))
