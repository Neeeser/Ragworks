"""Check each chunker's window against the embedding models it feeds.

The constraint belongs to the embedder — it is the model's input limit — but
the field a user changes to satisfy it is the chunker's, so findings are
addressed to the chunker while the message names the model imposing the limit.

Chunks are followed through the graph rather than across a single edge, along
`items` streams: the walk starts at each chunker's items outputs and continues
past an intermediate node only through outputs declaring `preserves` — the
port system's own statement that the node forwards the items it received — so
adding a forwarding node cannot silently switch the check off, while nodes
that emit *new* items (retrievers) end the walk. A chunker reaching an
embedder *through* another node says so, because a node in between may change
chunk sizes and the configured window then no longer describes what arrives.

Findings are advisory, never blocking. An oversized window still ingests — the
embedding guard splits the chunk and the file row carries a warning badge — so
refusing the save would strand work in progress over a condition the run
recovers from on its own.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from pydantic import ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.nodes.chunking import BaseChunkerNode, FixedChunkerConfig
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.ports import PortKind
from app.pipelines.registry import NodeRegistry
from app.providers.base import effective_embedding_input_limit

_TOKENIZER_LABELS = {
    "wordpiece": "BERT WordPiece",
    "cl100k": "cl100k",
    "huggingface": "HuggingFace tokenizer",
}


@dataclass(frozen=True)
class _EmbedderLimit:
    """One embedder's resolved effective input limit."""

    node_id: str
    model: str
    maximum: int


def _tokenizer_label(tokenizer: str) -> str:
    """Return the established human-readable counter label."""
    return _TOKENIZER_LABELS.get(tokenizer, tokenizer)


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
    ports = node_cls.output_ports if outgoing else node_cls.input_ports
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


def _chunk_hops(
    definition: PipelineDefinition, registry: NodeRegistry
) -> dict[str, dict[str, int]]:
    """Map each chunker to the embedders it reaches, and in how many hops.

    The walk starts on every items edge leaving a chunker and continues past
    an intermediate node only through its *preserving* items outputs — the
    port declaration that the node forwards the items it received. A
    non-preserving output emits new items (a retriever's matches), so the
    chunker's window no longer describes them and the walk stops.
    Breadth-first, so the recorded distance is the shortest path: a chunker
    wired both directly and through another node is judged on the direct feed.
    """
    node_map = definition.node_map()
    origin_adjacency, forward_adjacency = _items_adjacency(definition, registry)

    reach: dict[str, dict[str, int]] = {}
    for node in definition.nodes:
        node_cls = registry.get_node_class(node.type)
        if node_cls is None or not issubclass(node_cls, BaseChunkerNode):
            continue
        found: dict[str, int] = {}
        seen = {node.id}
        queue: deque[tuple[str, int]] = deque(
            (target, 1) for target in origin_adjacency.get(node.id, [])
        )
        while queue:
            current, hops = queue.popleft()
            if current in seen:
                continue
            seen.add(current)
            if node_map[current].type == EmbedderNode.type:
                found[current] = hops
                # An embedder consumes the chunks' text; nothing continues past it.
                continue
            queue.extend((target, hops + 1) for target in forward_adjacency.get(current, []))
        if found:
            reach[node.id] = found
    return reach


def _unknown_limit_issue(node_id: str, model: str) -> PipelineValidationIssue:
    """Return the documented saveable warning for unpublished model limits."""
    return PipelineValidationIssue(
        code="embedding_input_limit_unknown",
        message=(
            f"Embedding model '{model}' does not publish an input token limit; "
            "chunk-size compatibility could not be verified."
        ),
        severity="warning",
        node_id=node_id,
        model=model,
    )


def _chunk_limit_issue(
    chunker: PipelineNodeDefinition,
    limit: _EmbedderLimit,
    *,
    indirect: bool,
) -> PipelineValidationIssue | None:
    """Build an advisory issue for a window the downstream model cannot take."""
    try:
        config = FixedChunkerConfig.model_validate(chunker.config or {})
    except ValidationError:
        return None
    chunk_size = getattr(config, "chunk_size", None)
    chunk_overlap = getattr(config, "chunk_overlap", None)
    if not isinstance(chunk_size, int) or not isinstance(chunk_overlap, int):
        return None
    # Overlap is added to chunk_size, so the emitted chunk — and what the
    # embedder receives — is their sum. Comparing chunk_size alone misses every
    # window that overflows only once the repeated tail is counted.
    window = chunk_size + chunk_overlap
    if window <= limit.maximum:
        return None
    tokenizer = config.tokenizer
    is_whitespace = tokenizer == "whitespace"
    if is_whitespace:
        detail = "The whitespace counter undercounts model tokens."
    else:
        detail = f"The chunker uses {_tokenizer_label(tokenizer)} token counts."
    if indirect:
        detail += (
            f" Chunks reach '{limit.node_id}' through another node, which may change their size."
        )
    return PipelineValidationIssue(
        code="embedding_input_limit_exceeded",
        message=(
            f"Chunk size plus overlap ({chunk_size:,} + {chunk_overlap:,} = "
            f"{window:,}) on node '{chunker.id}' exceeds embedding model "
            f"'{limit.model}' effective input limit of {limit.maximum:,}. {detail}"
        ),
        # Advisory, never blocking: an oversized window still ingests — the
        # embedding guard splits the chunk and the file row carries a warning
        # badge — so refusing the save would strand work in progress over a
        # condition the run itself recovers from.
        severity="warning",
        node_id=chunker.id,
        field="chunk_size",
        configured_value=window,
        model=limit.model,
        allowed_max=limit.maximum,
    )


def embedding_limit_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    resolve_limit: object,
) -> list[PipelineValidationIssue]:
    """Return findings comparing chunk windows with downstream model limits."""
    if not callable(resolve_limit):
        return []
    node_map = definition.node_map()
    reach = _chunk_hops(definition, registry)
    limits: dict[str, _EmbedderLimit] = {}
    issues: list[PipelineValidationIssue] = []
    reachable = {embedder for targets in reach.values() for embedder in targets}
    for embedder_id in sorted(reachable):
        config = EmbedderConfig.model_validate(node_map[embedder_id].config or {})
        if config.connection_id is None or not config.model_name:
            # The embedder already reports its own missing-model error; a
            # second finding here would be noise on an invalid pipeline.
            continue
        published = resolve_limit(config.connection_id, config.model_name)
        if published is None:
            issues.append(_unknown_limit_issue(embedder_id, config.model_name))
            continue
        limits[embedder_id] = _EmbedderLimit(
            node_id=embedder_id,
            model=config.model_name,
            maximum=effective_embedding_input_limit(published),
        )

    for chunker_id, targets in reach.items():
        known = [(limits[node_id], hops) for node_id, hops in targets.items() if node_id in limits]
        if not known:
            continue
        # A chunk must fit every embedder it flows into, so the smallest limit
        # is the binding one. One issue per chunker, not one per pair: the
        # editor renders a single issue per field, so several would hide each
        # other — possibly leaving the least restrictive one showing.
        limit, hops = min(known, key=lambda entry: (entry[0].maximum, entry[0].node_id))
        issue = _chunk_limit_issue(node_map[chunker_id], limit, indirect=hops > 1)
        if issue is not None:
            issues.append(issue)
    return issues
