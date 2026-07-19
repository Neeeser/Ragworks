"""Deterministic, node-addressed recommendations derived from the recall funnel.

No LLM: each finding is a rule over the aggregated funnel, and it always names the
specific node that caused a gold-document loss (by id and label), so a pipeline
with several retrievers or rerankers is diagnosed node by node rather than by an
abstract stage name. A clean seam is left for an optional LLM narrative layer
later — it would consume these findings, not replace them.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.evals.attribution.constants import INGESTION_NODE_ID
from app.schemas.enums import EvalFindingSeverity
from app.schemas.evals import EvalFinding, FunnelStage

_DROP_WARNING = 0.15
_DROP_CRITICAL = 0.30


def derive_findings(
    stages: Sequence[FunnelStage],
    edges: Sequence[tuple[str, str]],
) -> list[EvalFinding]:
    """Turn a funnel into node-addressed findings, most severe first."""
    retention = {stage.node_id: stage.retention for stage in stages}
    labels = {stage.node_id: stage.label for stage in stages}
    upstream = _upstream_map(edges)
    ingestion_retention = retention.get(INGESTION_NODE_ID, 1.0)

    scored: list[tuple[int, float, EvalFinding]] = []

    ingestion_loss = 1.0 - ingestion_retention
    if ingestion_loss >= _DROP_WARNING:
        scored.append(
            (
                _severity_rank(ingestion_loss),
                ingestion_loss,
                EvalFinding(
                    node_id=INGESTION_NODE_ID,
                    label=labels.get(INGESTION_NODE_ID, "Indexed coverage"),
                    severity=_severity(ingestion_loss),
                    category="ingestion",
                    message=(
                        f"{ingestion_loss:.0%} of gold documents produced no chunks "
                        "during ingestion — check the parser and chunker for these files."
                    ),
                ),
            )
        )

    for stage in stages:
        if stage.node_id == INGESTION_NODE_ID:
            continue
        baseline = _baseline_retention(stage.node_id, upstream, retention, ingestion_retention)
        drop = baseline - stage.retention
        if drop < _DROP_WARNING:
            continue
        scored.append(
            (
                _severity_rank(drop),
                drop,
                _node_finding(stage, drop),
            )
        )

    scored.sort(key=lambda item: (-item[0], -item[1]))
    return [finding for _, _, finding in scored]


def _node_finding(stage: FunnelStage, drop: float) -> EvalFinding:
    """Build the finding for a node that dropped gold relative to its inputs."""
    category = _classify(stage.node_type)
    message = _message(category, stage, drop)
    return EvalFinding(
        node_id=stage.node_id,
        label=stage.label,
        severity=_severity(drop),
        category=category,
        message=message,
    )


def _message(category: str, stage: FunnelStage, drop: float) -> str:
    """Compose the plain-language, node-addressed message for a finding."""
    identity = f"Node '{stage.label}' ({stage.node_id})"
    if category == "reranking":
        return (
            f"{identity} demoted {drop:.0%} of gold documents its inputs had "
            "retrieved. Test the pipeline with this reranker disabled."
        )
    if category == "retrieval":
        return (
            f"{identity} retrieved {stage.retention:.0%} of gold documents; "
            f"{drop:.0%} of indexed gold never entered its results. Consider a "
            "different embedder or a larger top_k."
        )
    if category == "fusion":
        return f"{identity} lost {drop:.0%} of gold documents its inputs had retrieved."
    return f"{identity} dropped {drop:.0%} of gold documents relative to its inputs."


# Node type ids are `<family>.<variant>` (`retriever.vector`, `fusion.rrf`,
# `reranker.model`), and the family segment is as permanent as the id itself —
# classifying on it means a new variant is categorized with no second place to
# update, where substring matching silently missorted new families.
_CATEGORY_BY_FAMILY = {
    "reranker": "reranking",
    "fusion": "fusion",
    "retriever": "retrieval",
}


def _classify(node_type: str) -> str:
    """Map a node type id to a finding category via its family prefix."""
    family = node_type.split(".", 1)[0].lower()
    return _CATEGORY_BY_FAMILY.get(family, "pipeline")


def _upstream_map(edges: Sequence[tuple[str, str]]) -> dict[str, list[str]]:
    """Build downstream-node -> [upstream-node] from the edge list."""
    upstream: dict[str, list[str]] = {}
    for source, target in edges:
        upstream.setdefault(target, []).append(source)
    return upstream


def _baseline_retention(
    node_id: str,
    upstream: dict[str, list[str]],
    retention: dict[str, float],
    ingestion_retention: float,
) -> float:
    """Return the retention a node inherited: the best of its inputs, or ingestion."""
    sources = [retention[source] for source in upstream.get(node_id, []) if source in retention]
    if not sources:
        return ingestion_retention
    return max(sources)


_SEVERITY_RANK = {
    EvalFindingSeverity.INFO: 0,
    EvalFindingSeverity.WARNING: 1,
    EvalFindingSeverity.CRITICAL: 2,
}


def _severity(drop: float) -> EvalFindingSeverity:
    """Map a retention drop to a finding severity."""
    if drop >= _DROP_CRITICAL:
        return EvalFindingSeverity.CRITICAL
    if drop >= _DROP_WARNING:
        return EvalFindingSeverity.WARNING
    return EvalFindingSeverity.INFO


def _severity_rank(drop: float) -> int:
    """Sortable rank for a drop's severity (higher is more severe)."""
    return _SEVERITY_RANK[_severity(drop)]
