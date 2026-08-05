"""Runtime partitioning of item streams against a port's `accepts` contract.

A node that declares `accepts` on an items input operates on part of its
stream: a lexical indexer indexes the text items, a vision shell describes
the image items. The split is one shared implementation so no node codes
its own skip rule — a rule written inside a node is invisible to the
trace and drifts from what the editor's static analysis predicted.

Nodes re-derive the partition in `summarize_io`; it is a pure function of
the items and the resolved accepts set, so nothing has to be carried
between the two calls.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.pipelines.payloads import Item
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceValue


@dataclass(frozen=True)
class ItemPartition:
    """One item stream split into what a node processes and what it does not.

    `positions` keeps each accepted item's index in the original stream so
    a passthrough merge can restore stream order rather than grouping the
    processed items ahead of the untouched ones.
    """

    accepted: tuple[Item, ...]
    unaccepted: tuple[Item, ...]
    positions: tuple[int, ...]
    passthrough: bool

    @property
    def skipped(self) -> int:
        """How many items this node does not operate on."""
        return len(self.unaccepted)

    @property
    def partial(self) -> bool:
        """True when the node operates on only part of the stream."""
        return bool(self.unaccepted) and bool(self.accepted)

    def merge(self, processed: Sequence[Item]) -> list[Item]:
        """Recombine a node's processed items with the ones it skipped.

        An `exclude` port drops the skipped items — a sink writes what it
        accepted and nothing else. A `passthrough` port re-emits them,
        interleaved back into their original positions when the node
        returned one item per accepted item. A node that changed the item
        count (the embedding guard splitting an oversized chunk) has no
        position mapping left, so its output leads and the skipped items
        follow — stream position is not the ordering contract, `Item.order`
        is.
        """
        if not self.passthrough:
            return list(processed)
        if not self.unaccepted:
            return list(processed)
        if len(processed) != len(self.positions):
            return [*processed, *self.unaccepted]
        merged: list[Item | None] = [None] * (len(processed) + len(self.unaccepted))
        for position, item in zip(self.positions, processed, strict=True):
            merged[position] = item
        remaining = iter(self.unaccepted)
        return [item if item is not None else next(remaining) for item in merged]


def partition_items(
    items: Sequence[Item], port: NodePort, *, accepts: frozenset[str] | None = None
) -> ItemPartition:
    """Split `items` against a port's accepts contract.

    Acceptance reads the facets an item actually carries, never what an
    upstream port claimed: a node earlier in the graph may have processed
    only part of its own stream, so the declaration and the item can
    honestly disagree. `accepts` overrides the port declaration for nodes
    whose contract depends on their configuration (an embedder takes
    images only when its model does).

    An unrestricted port accepts everything, which is the default and
    leaves every existing node's behavior untouched.
    """
    allowed = frozenset(port.accepts) if accepts is None else accepts
    passthrough = port.unaccepted == "passthrough"
    if not allowed:
        return ItemPartition(
            accepted=tuple(items),
            unaccepted=(),
            positions=tuple(range(len(items))),
            passthrough=passthrough,
        )
    accepted: list[Item] = []
    unaccepted: list[Item] = []
    positions: list[int] = []
    for position, item in enumerate(items):
        if item.facets() & allowed:
            accepted.append(item)
            positions.append(position)
        else:
            unaccepted.append(item)
    return ItemPartition(
        accepted=tuple(accepted),
        unaccepted=tuple(unaccepted),
        positions=tuple(positions),
        passthrough=passthrough,
    )


def partition_trace_value(partition: ItemPartition, *, label: str = "Skipped") -> NodeTraceValue:
    """Summarize what a node skipped, and what those items were.

    Recorded whenever a node partitions, so a run explains a stream that
    shrank between two nodes. The modality breakdown names the reason —
    "2 image" reads as a contract, "2 skipped" reads as a failure.
    """
    counts: dict[str, int] = {}
    for item in partition.unaccepted:
        for facet in sorted(item.facets()):
            counts[facet] = counts.get(facet, 0) + 1
    return NodeTraceValue(
        label=label,
        value={"count": partition.skipped, "facets": counts},
    )
