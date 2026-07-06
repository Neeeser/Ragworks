"""Validation helpers shared across pipeline node types.

Small named functions instead of one large per-node validation method -- see
`IndexerNode.validation_issues_for_node` (indexing.py) and
`PineconeRetrieverNode.validation_issues_for_node` (retrieval.py) for how they
compose these.
"""

from __future__ import annotations

from app.pipelines.node import PipelineValidationIssue


def missing_index_issue(index_name: str, node_id: str, role: str) -> PipelineValidationIssue | None:
    """Flag a blank Pinecone index name on an indexer/retriever node.

    `role` names the node kind in the message, e.g. "Indexer" or "Retriever".
    """
    if index_name.strip():
        return None
    return PipelineValidationIssue(
        message=f"{role} node '{node_id}' must specify a Pinecone index.",
        severity="error",
    )
