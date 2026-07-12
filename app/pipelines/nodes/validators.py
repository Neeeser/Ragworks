"""Validation helpers shared across pipeline node types.

Small named functions instead of one large per-node validation method -- see
`BaseIndexerNode.validation_issues_for_node` (indexing.py) and
`BaseRetrieverNode.validation_issues_for_node` (retrieval.py) for how they
compose these.
"""

from __future__ import annotations

from app.pipelines.node import PipelineValidationIssue
from app.vectorstores.base import VectorStoreCapabilities


def missing_index_issue(index_name: str, node_id: str, role: str) -> PipelineValidationIssue | None:
    """Flag a blank index name on an indexer/retriever node.

    `role` names the node kind in the message, e.g. "Indexer" or "Retriever".
    """
    if index_name.strip():
        return None
    return PipelineValidationIssue(
        message=f"{role} node '{node_id}' must specify an index.",
        severity="error",
    )


def lexical_support_issue(
    capabilities: VectorStoreCapabilities,
    backend_label: str,
    node_id: str,
) -> PipelineValidationIssue | None:
    """Flag a BM25 node targeting a backend with no sparse-index support."""
    if capabilities.supports_lexical:
        return None
    return PipelineValidationIssue(
        message=(
            f"Node '{node_id}' requires sparse (BM25) indexes, which the "
            f"{backend_label} backend does not support."
        ),
        severity="error",
    )


def capability_issues(
    capabilities: VectorStoreCapabilities,
    *,
    backend_label: str,
    node_id: str,
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
                    f"Node '{node_id}' dimension {dimension} exceeds the "
                    f"{backend_label} backend's maximum of {capabilities.max_dimension}."
                ),
                severity="error",
            )
        )
    if metric is not None and metric not in capabilities.supported_metrics:
        supported = ", ".join(capabilities.supported_metrics)
        issues.append(
            PipelineValidationIssue(
                message=(
                    f"Node '{node_id}' metric '{metric}' is not supported by the "
                    f"{backend_label} backend (supported: {supported})."
                ),
                severity="error",
            )
        )
    return issues
