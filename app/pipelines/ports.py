"""Port kinds, item facets, and connection compatibility for pipeline nodes.

Ports are typed by *data shape*, not pipeline stage. The unified `items`
kind carries every list-of-items value (the uploaded file, chunks, embedded
chunks, the query, retrieval matches); what a particular stream guarantees
about its items is expressed as facets (`file`, `text`, `embedding`,
`score`) declared on ports and inferred through the graph
(`app/pipelines/facets.py`). The remaining kinds are genuinely distinct
planes: named structured values and the terminal result.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class PortKind(StrEnum):
    """Data kinds that flow between pipeline node input/output ports.

    Node port declarations use the raw string values; this enum is the
    single catalog of valid kinds.
    """

    ITEMS = "items"
    STRUCTURED_VALUES = "structured_values"
    RESULT = "result"


class Facet(StrEnum):
    """Per-item guarantees an `items` stream can carry.

    A stream guarantees a facet when every item in it carries that field:
    `file` for the uploaded file itself, `text` for textual content,
    `image` for a referenced image asset, `embedding` for a dense vector,
    `score` for a ranking score. Ports require facets on input and
    add/preserve them on output; `app/pipelines/facets.py` infers the
    guarantees through a graph.

    `file`, `text` and `image` are *content* modalities — what an item
    actually is, and what a node's `accepts` contract selects on.
    `embedding`/`score` are derived annotations. `CONTENT_MODALITIES` names
    the split; audio and video join it with the first node that produces
    them.
    """

    FILE = "file"
    TEXT = "text"
    IMAGE = "image"
    EMBEDDING = "embedding"
    SCORE = "score"


#: The content modalities — the facets that describe what an item *is*.
#: Modality coverage analysis (`app/pipelines/modality.py`) walks these
#: only: losing an item's embedding downstream is a wiring choice, losing
#: the item's content means it never reaches an index at all.
CONTENT_MODALITIES: frozenset[str] = frozenset({Facet.FILE, Facet.TEXT, Facet.IMAGE})


class NodePort(BaseModel):
    """Port metadata describing node input/output connectivity.

    An input port with `accepts_many=True` is variadic: any number of edges
    may target it, the executor collects every inbound value into a list
    (always a list, even for a single edge), and the node runs only once all
    wired edges have delivered. Output ports never set it.

    Facet fields apply to `items`-kind ports only:

    - `requires` (inputs): facets every inbound stream must guarantee.
    - `accepts` (inputs): the content modalities this node operates on.
      Empty means unrestricted — the node processes every item. A
      restricted port partitions its stream at run time
      (`app/pipelines/partition.py`): items carrying one of these facets
      are processed, the rest follow `unaccepted`. This is what makes a
      lexical indexer skipping image items ordinary typed dataflow rather
      than an exception coded into that node.
    - `unaccepted` (inputs): `passthrough` re-emits unprocessed items into
      the node's output stream (transforms), `exclude` drops them (sinks).
    - `adds` (outputs): facets this node stamps onto every item it
      processes.
    - `preserves` (outputs): the output keeps the facets its items input
      guaranteed (intersection across inbound edges), plus `adds`. A
      non-preserving output guarantees exactly `adds` — its items are new.

    `requires` and `accepts` answer different questions and neither
    replaces the other: `requires` is a graph-level contract whose breach
    is a validation error (a retriever with no embedded query cannot run
    at all), while `accepts` is a per-item runtime filter whose ordinary
    outcome is that some items are skipped.

    `preserves` deliberately reads the intersection of *all* the node's
    items inputs, not a named one: every current node has at most one items
    output, and a per-input binding is a parameter no caller needs yet. A
    future node with two items inputs feeding two per-input preserving
    outputs would extend `preserves` to name its input port — in both
    implementations plus the shared vectors, like any facet semantics
    change.
    """

    key: str
    label: str
    data_type: str
    required: bool = True
    accepts_many: bool = False
    requires: tuple[str, ...] = ()
    accepts: tuple[str, ...] = ()
    unaccepted: Literal["passthrough", "exclude"] = "passthrough"
    adds: tuple[str, ...] = ()
    preserves: bool = False


def compatible_kinds(source_type: str, target_type: str) -> bool:
    """Return True when a source port's data kind may connect to a target's.

    Kind compatibility is identity; facet compatibility is a graph property
    checked by `app/pipelines/facets.py` (an edge's guarantees depend on
    everything upstream, not on the two ports alone).
    """
    return source_type == target_type
