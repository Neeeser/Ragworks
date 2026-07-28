"""Chunk-size vs embedding-input-limit validation.

Split from `validation.py` (the structural validator) purely for module
size: compares each chunker feeding an embedder against the embedding
model's published input limit, severity-aware per tokenizer (a whitespace
counter undercounts, so it warns instead of erroring).
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from pydantic import ValidationError

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.nodes.chunking import BaseChunkerNode, FixedChunkerConfig
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.registry import NodeRegistry
from app.providers.base import effective_embedding_input_limit

EmbeddingInputLimitResolver = Callable[[UUID, str], int | None]


def check_embedding_input_limits(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    embedding_input_limit: EmbeddingInputLimitResolver | None,
) -> list[PipelineValidationIssue]:
    """Compare each chunker feeding an embedder with its provider limit."""
    if embedding_input_limit is None:
        return []
    node_map = definition.node_map()
    incoming = definition.incoming_edges()
    chunk_input = EmbedderNode.input_ports[0].key
    issues: list[PipelineValidationIssue] = []
    for embedder in definition.nodes:
        if embedder.type != EmbedderNode.type:
            continue
        config = EmbedderConfig.model_validate(embedder.config or {})
        if config.connection_id is None or not config.model_name:
            continue
        chunkers = _connected_chunkers(
            registry, incoming.get(embedder.id, []), node_map, chunk_input
        )
        if not chunkers:
            continue
        published_limit = embedding_input_limit(config.connection_id, config.model_name)
        if published_limit is None:
            issues.append(_unknown_embedding_limit_issue(embedder.id, config.model_name))
            continue
        maximum = effective_embedding_input_limit(published_limit)
        for chunker in chunkers:
            issue = _chunk_limit_issue(
                chunker,
                model=config.model_name,
                maximum=maximum,
            )
            if issue is not None:
                issues.append(issue)
    return issues


def _connected_chunkers(
    registry: NodeRegistry,
    edges: list[PipelineEdgeDefinition],
    node_map: dict[str, PipelineNodeDefinition],
    chunk_input: str,
) -> list[PipelineNodeDefinition]:
    """Return real chunker nodes connected to an embedder's chunk input."""
    chunkers: list[PipelineNodeDefinition] = []
    for edge in edges:
        if edge.target_port not in (None, chunk_input):
            continue
        chunker = node_map.get(edge.source)
        if chunker is None:
            continue
        chunker_cls = registry.get_node_class(chunker.type)
        if chunker_cls is not None and issubclass(chunker_cls, BaseChunkerNode):
            chunkers.append(chunker)
    return chunkers


def _chunk_limit_issue(
    chunker: PipelineNodeDefinition,
    *,
    model: str,
    maximum: int,
) -> PipelineValidationIssue | None:
    """Build a severity-aware issue for an oversized configured span."""
    try:
        config = FixedChunkerConfig.model_validate(chunker.config or {})
    except ValidationError:
        return None
    chunk_size = getattr(config, "chunk_size", None)
    if not isinstance(chunk_size, int):
        return None
    # Each emitted chunk spans at most chunk_size tokens — overlap is a
    # stride within that window, not extra tokens the embedder ever sees —
    # so only chunk_size is bounded by the model's input limit. Comparing
    # chunk_size + overlap here once flagged (and clamped) windows that
    # actually fit, so the wizard's shown size differed from what ingest
    # used and a valid default tripped an error.
    if chunk_size <= maximum:
        return None
    tokenizer = config.tokenizer
    is_whitespace = tokenizer == "whitespace"
    severity = "warning" if is_whitespace else "error"
    detail = (
        "The whitespace counter undercounts model tokens."
        if is_whitespace
        else f"The chunker uses {_tokenizer_label(tokenizer)} token counts."
    )
    return PipelineValidationIssue(
        code="embedding_input_limit_exceeded",
        message=(
            f"Chunk size ({chunk_size:,}) on node '{chunker.id}' "
            f"exceeds embedding model '{model}' effective input limit of {maximum:,}. "
            f"{detail}"
        ),
        severity=severity,
        node_id=chunker.id,
        field="chunk_size",
        configured_value=chunk_size,
        model=model,
        allowed_max=maximum,
    )


def _tokenizer_label(tokenizer: str) -> str:
    """Return the established human-readable counter label."""
    return {
        "wordpiece": "BERT WordPiece",
        "cl100k": "cl100k",
        "huggingface": "HuggingFace tokenizer",
    }.get(tokenizer, tokenizer)


def _unknown_embedding_limit_issue(
    node_id: str,
    model: str,
) -> PipelineValidationIssue:
    """Return the documented saveable warning for unpublished model limits."""
    return PipelineValidationIssue(
        code="embedding_input_limit_unknown",
        message=(
            f"Embedding model '{model}' does not publish an input token limit; "
            "chunk-size compatibility could not be verified."
        ),
        severity="warning",
        node_id=node_id,
        field="model_name",
        configured_value=model,
        model=model,
    )
