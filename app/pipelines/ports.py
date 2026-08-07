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

from pydantic import BaseModel, model_validator


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
    - `optional_adds` (outputs): facets this node stamps onto some of the
      items it processes. They reach the *potentials* bound only, never
      guarantees: a query port carries an image when the request supplied
      one and carries none otherwise, so declaring `image` in `adds`
      would let every downstream `requires=(image,)` edge validate
      against a promise the run breaks.
    - `preserves` (outputs): the output keeps the facets its items input
      guaranteed (intersection across inbound edges), plus `adds`. A
      non-preserving output guarantees exactly `adds` — its items are new.
    - `removes` (outputs): facets stripped from the items this node
      processes, because it rewrote the content they were derived from.
      Items that bypass processing (a restricted `accepts` with
      `passthrough`) keep theirs, so a stream where nothing can be
      processed loses nothing.

    `preserves` and `removes` answer different questions: `preserves` asks
    whether these are the same items, `removes` asks which derived facets
    no longer describe them. A resize keeps an item's identity while
    invalidating the vector computed from its old pixels, and only
    `removes` can say so — a port claiming `embedding` after such a rewrite
    delivers a vector describing content that no longer exists, and the
    indexer writes it.

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
    optional_adds: tuple[str, ...] = ()
    preserves: bool = False
    removes: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_facet_declarations(self) -> NodePort:
        """Reject a port whose facet declarations contradict each other.

        Stamping and stripping one facet are contradictory instructions,
        and inference has to pick an order to apply them in — whichever it
        picks, the other declaration silently does nothing. A facet
        declared in both `adds` and `optional_adds` reads as the weaker
        claim while the guarantee still stands, so a downstream `requires`
        passes against a promise the run breaks.
        """
        stamped = frozenset(self.adds) | frozenset(self.optional_adds)
        stripped = stamped & frozenset(self.removes)
        if stripped:
            raise ValueError(
                f"Port '{self.key}' both adds and removes {', '.join(sorted(stripped))}."
            )
        both_bounds = frozenset(self.adds) & frozenset(self.optional_adds)
        if both_bounds:
            raise ValueError(
                f"Port '{self.key}' declares {', '.join(sorted(both_bounds))} as both a "
                "guaranteed and an optional add."
            )
        return self


def compatible_kinds(source_type: str, target_type: str) -> bool:
    """Return True when a source port's data kind may connect to a target's.

    Kind compatibility is identity; facet compatibility is a graph property
    checked by `app/pipelines/facets.py` (an edge's guarantees depend on
    everything upstream, not on the two ports alone).
    """
    return source_type == target_type
