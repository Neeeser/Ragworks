"""Validation helpers shared across pipeline node types.

Small named functions instead of one large per-node validation method -- see
`BaseIndexerNode.validation_issues_for_node` (indexing.py) and
`BaseRetrieverNode.validation_issues_for_node` (retrieval.py) for how they
compose these.

Every issue here describes one node, so every issue carries `node_id`: the
editor attributes a finding to a card by that field alone and drops one
without it, leaving a misconfigured node looking clean on the canvas.
"""

from __future__ import annotations

from uuid import UUID

from app.pipelines.definition import PipelineNodeDefinition
from app.pipelines.node import PipelineValidationIssue
from app.vectorstores.base import VectorStoreCapabilities


def missing_index_issue(
    index_name: str, node: PipelineNodeDefinition, role: str
) -> PipelineValidationIssue | None:
    """Flag a blank index name on an indexer/retriever node.

    `role` names the node kind in the message, e.g. "Indexer" or "Retriever".
    """
    if index_name.strip():
        return None
    return PipelineValidationIssue(
        message=f"{role} '{node.display_name}' must specify an index.",
        severity="error",
        node_id=node.id,
    )


def missing_top_k_issue(
    top_k: int | None, node: PipelineNodeDefinition, role: str
) -> PipelineValidationIssue | None:
    """Flag a retriever with no fetch depth configured.

    Retrieval depth is an explicit design choice — typically the `top_k`
    variable, or an over-retrieval expression like `top_k * 2` — never an
    invisible fallback to the run's requested depth.
    """
    if top_k is not None:
        return None
    return PipelineValidationIssue(
        message=(
            f"{role} '{node.display_name}' has no top_k configured. Set how many "
            "chunks it fetches (e.g. the top_k variable)."
        ),
        severity="error",
        node_id=node.id,
    )


def lexical_support_issue(
    capabilities: VectorStoreCapabilities,
    backend_label: str,
    node: PipelineNodeDefinition,
) -> PipelineValidationIssue | None:
    """Flag a BM25 node targeting a backend with no sparse-index support."""
    if capabilities.supports_lexical:
        return None
    return PipelineValidationIssue(
        message=(
            f"'{node.display_name}' requires sparse (BM25) indexes, which the "
            f"{backend_label} backend does not support."
        ),
        severity="error",
        node_id=node.id,
    )


def capability_issues(
    capabilities: VectorStoreCapabilities,
    *,
    backend_label: str,
    node: PipelineNodeDefinition,
    dimension: int | None,
    metric: str | None,
) -> list[PipelineValidationIssue]:
    """Flag config values that exceed a backend's declared capabilities.

    These are design-time errors: catching them here means a pipeline that
    would fail at ingest/query time (dimension over the backend's indexable
    max, unsupported metric) is rejected while it is being built.
    """
    issues: list[PipelineValidationIssue] = []
    if dimension is not None and dimension > capabilities.max_dimension:
        issues.append(
            PipelineValidationIssue(
                message=(
                    f"'{node.display_name}' dimension {dimension} exceeds the "
                    f"{backend_label} backend's maximum of {capabilities.max_dimension}."
                ),
                severity="error",
                node_id=node.id,
            )
        )
    if metric is not None and metric not in capabilities.supported_metrics:
        supported = ", ".join(capabilities.supported_metrics)
        issues.append(
            PipelineValidationIssue(
                message=(
                    f"'{node.display_name}' metric '{metric}' is not supported by the "
                    f"{backend_label} backend (supported: {supported})."
                ),
                severity="error",
                node_id=node.id,
            )
        )
    return issues


def lexical_count_support_issue(
    capabilities: VectorStoreCapabilities,
    backend_label: str,
    node: PipelineNodeDefinition,
) -> PipelineValidationIssue | None:
    """Flag a count node targeting a backend that cannot count lexical matches."""
    if capabilities.supports_lexical_count:
        return None
    return PipelineValidationIssue(
        message=(
            f"'{node.display_name}' requires lexical match counting, which the "
            f"{backend_label} backend does not support."
        ),
        severity="error",
        node_id=node.id,
    )


def lexical_facet_support_issue(
    capabilities: VectorStoreCapabilities,
    backend_label: str,
    node: PipelineNodeDefinition,
) -> PipelineValidationIssue | None:
    """Flag a facet node targeting a backend that cannot facet lexical matches."""
    if capabilities.supports_lexical_facet:
        return None
    return PipelineValidationIssue(
        message=(
            f"'{node.display_name}' requires lexical match faceting, which the "
            f"{backend_label} backend does not support."
        ),
        severity="error",
        node_id=node.id,
    )


def missing_model_issues(
    connection_id: UUID | None,
    model_name: str,
    node: PipelineNodeDefinition,
    role: str,
) -> list[PipelineValidationIssue]:
    """Flag a model-backed node with no provider connection or model chosen.

    The embedder and reranker shells share this verbatim, so a change to
    either message has to reach both — the editor renders them side by side
    and two spellings of one refusal read as two different problems.
    """
    issues: list[PipelineValidationIssue] = []
    if connection_id is None:
        issues.append(
            PipelineValidationIssue(
                message=(
                    f"{role} '{node.display_name}' has no provider connection "
                    "configured. Pick one in the pipeline editor."
                ),
                severity="error",
                node_id=node.id,
            )
        )
    if not model_name:
        issues.append(
            PipelineValidationIssue(
                message=(
                    f"{role} '{node.display_name}' has no model configured. "
                    "Pick one in the pipeline editor."
                ),
                severity="error",
                node_id=node.id,
            )
        )
    return issues
