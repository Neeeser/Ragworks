"""Port kinds, item facets, and connection compatibility for pipeline nodes.

Ports are typed by *data shape*, not pipeline stage. The unified `items`
kind carries every list-of-items value (chunks, embedded chunks, the query,
retrieval matches); what a particular stream guarantees about its items is
expressed as facets (`text`, `embedding`, `score`) declared on ports and
inferred through the graph (`app/pipelines/facets.py`). The remaining kinds
are genuinely distinct planes: document sources, parsed documents, named
structured values, and the terminal result.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class PortKind(StrEnum):
    """Data kinds that flow between pipeline node input/output ports.

    Node port declarations use the raw string values; this enum is the
    single catalog of valid kinds.
    """

    DOCUMENT_SOURCE = "document_source"
    DOCUMENT = "document"
    ITEMS = "items"
    STRUCTURED_VALUES = "structured_values"
    RESULT = "result"


class Facet(StrEnum):
    """Per-item guarantees an `items` stream can carry.

    A stream guarantees a facet when every item in it carries that field:
    `text` for textual content, `embedding` for a dense vector, `score` for
    a ranking score. Ports require facets on input and add/preserve them on
    output; `app/pipelines/facets.py` infers the guarantees through a graph.
    """

    TEXT = "text"
    EMBEDDING = "embedding"
    SCORE = "score"


class NodePort(BaseModel):
    """Port metadata describing node input/output connectivity.

    An input port with `accepts_many=True` is variadic: any number of edges
    may target it, the executor collects every inbound value into a list
    (always a list, even for a single edge), and the node runs only once all
    wired edges have delivered. Output ports never set it.

    Facet fields apply to `items`-kind ports only:

    - `requires` (inputs): facets every inbound stream must guarantee.
    - `adds` (outputs): facets this node stamps onto every emitted item.
    - `preserves` (outputs): the output keeps the facets its items input
      guaranteed (intersection across inbound edges), plus `adds`. A
      non-preserving output guarantees exactly `adds` — its items are new.

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
    adds: tuple[str, ...] = ()
    preserves: bool = False


def compatible_kinds(source_type: str, target_type: str) -> bool:
    """Return True when a source port's data kind may connect to a target's.

    Kind compatibility is identity; facet compatibility is a graph property
    checked by `app/pipelines/facets.py` (an edge's guarantees depend on
    everything upstream, not on the two ports alone).
    """
    return source_type == target_type
