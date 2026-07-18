"""Fusion nodes: combine several retrieval result streams into one.

`BaseFusionNode` owns the take-many-emit-one shape — a single variadic
`results` input port (`accepts_many`) that the executor delivers as a list of
`RetrievalPayload`s, one per inbound edge — so every fusion strategy (RRF
today; weighted/alpha blending later) only implements `fuse()` over the
collected match lists. Usage is summed across branches.
"""

from __future__ import annotations

import builtins
from abc import abstractmethod

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    RankingEvidence,
    RankingResultEvidence,
    RankingSourceEvidence,
    combine_usage,
    summarize_match_order,
    summarize_matches,
    trace_match_items,
)
from app.retrieval.models import RetrievalResponse, ScoredChunk


class FusionConfig(BaseModel):
    """Base configuration for fusion nodes."""


class BaseFusionNode(PipelineNodeBase[FusionConfig]):
    """Shared fusion behavior: collect N result streams, emit one."""

    category = "retrieval"
    input_ports = (
        NodePort(
            key="results",
            label="Results",
            data_type="retrieval_results",
            accepts_many=True,
        ),
    )
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model: builtins.type[FusionConfig] = FusionConfig

    @abstractmethod
    def fuse(
        self,
        branches: list[list[ScoredChunk]],
        context: PipelineRunContext,
    ) -> list[ScoredChunk]:
        """Combine per-branch match lists into one fused, ordered list."""

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Fuse every inbound result stream into a single response."""
        payloads = self._collect_payloads(inputs)
        fused = self.fuse([list(payload.response.matches) for payload in payloads], context)
        return {
            "results": RetrievalPayload(
                response=RetrievalResponse(matches=fused),
                usage=combine_usage([payload.usage for payload in payloads]),
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize per-branch orders and the fused order."""
        payloads = self._collect_payloads(inputs)
        output_payload = RetrievalPayload.model_validate(outputs.get("results"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label=f"Branch {index} order",
                    value=summarize_match_order(payload.response.matches),
                )
                for index, payload in enumerate(payloads, start=1)
            ]
            + [
                NodeTraceValue(
                    label=f"Branch {index} items",
                    value=trace_match_items(payload.response.matches),
                    kind="items",
                )
                for index, payload in enumerate(payloads, start=1)
            ],
            outputs=[
                NodeTraceValue(
                    label="Matches",
                    value=summarize_matches(output_payload.response.matches, limit=10),
                ),
                NodeTraceValue(
                    label="Fused order",
                    value=summarize_match_order(output_payload.response.matches),
                ),
                NodeTraceValue(
                    label="Fused items",
                    value=trace_match_items(output_payload.response.matches),
                    kind="items",
                ),
                NodeTraceValue(
                    label="Ranking evidence",
                    value=self._ranking_evidence(
                        [list(payload.response.matches) for payload in payloads],
                        list(output_payload.response.matches),
                    ),
                    kind="ranking",
                ),
            ],
        )

    def _ranking_evidence(
        self,
        _branches: list[list[ScoredChunk]],
        fused: list[ScoredChunk],
    ) -> RankingEvidence:
        """Describe output ranking facts; subclasses add method-specific sources."""
        return RankingEvidence(
            method=self.type,
            results=[
                RankingResultEvidence(id=match.chunk.chunk_id, rank=rank, score=match.score)
                for rank, match in enumerate(fused, start=1)
            ],
        )

    @staticmethod
    def _collect_payloads(inputs: dict[str, object]) -> list[RetrievalPayload]:
        """Validate the variadic `results` input into typed payloads.

        The executor always delivers an `accepts_many` port as a list; a bare
        payload is tolerated for direct node-level callers (tests).
        """
        raw = inputs.get("results")
        items = raw if isinstance(raw, list) else [raw]
        return [RetrievalPayload.model_validate(item) for item in items]


class RRFusionConfig(FusionConfig):
    """Configuration for reciprocal rank fusion.

    `k` is the standard RRF dampening constant (Cormack et al.: 60): higher
    values flatten the difference between ranks. Fusion never truncates —
    cutting the fused list is the Top-N node's job (`limit.top_n`), so the
    cut is always an explicit, traced step.
    """

    k: int = Field(
        default=60,
        ge=1,
        title="Rank dampening (k)",
        description=(
            "Dampening constant in the RRF formula 1 / (k + rank). Higher "
            "values flatten the difference between ranks. Not a result "
            "count — fusion emits every fused candidate."
        ),
    )


class RRFusionNode(BaseFusionNode):
    """Fuse result streams by reciprocal rank (RRF)."""

    type = "fusion.rrf"
    label = "RRF Fusion"
    description = (
        "Combine results from multiple retrievers by reciprocal rank — "
        "robust fusion without comparable scores (e.g. semantic + BM25)."
    )
    example = "[semantic: (a, b), bm25: (b, c)] -> RetrievalPayload(b, a, c)."
    config_model = RRFusionConfig

    # Narrowed for typed access; the base declares `FusionConfig`.
    config: RRFusionConfig

    def fuse(
        self,
        branches: list[list[ScoredChunk]],
        context: PipelineRunContext,
    ) -> list[ScoredChunk]:
        """Score each chunk by summed reciprocal rank across branches.

        Chunk identity is `chunk_id` (stable `{document_id}:{order}` across
        indexes, so the same chunk retrieved by several branches accumulates).
        The fused score replaces per-branch scores — raw BM25 and cosine
        values are not comparable. Every fused chunk is emitted; cutting the
        list is the Top-N node's job.
        """
        scores: dict[str, float] = {}
        first_seen: dict[str, ScoredChunk] = {}
        for matches in branches:
            for rank, match in enumerate(matches, start=1):
                chunk_id = match.chunk.chunk_id
                scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (self.config.k + rank)
                first_seen.setdefault(chunk_id, match)
        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        return [
            ScoredChunk(chunk=first_seen[chunk_id].chunk, score=score)
            for chunk_id, score in ordered
        ]

    def _ranking_evidence(
        self,
        branches: list[list[ScoredChunk]],
        fused: list[ScoredChunk],
    ) -> RankingEvidence:
        """Record every branch rank and its reciprocal-rank contribution."""
        branch_items = [
            {
                match.chunk.chunk_id: (rank, match.score)
                for rank, match in enumerate(matches, start=1)
            }
            for matches in branches
        ]
        results: list[RankingResultEvidence] = []
        for rank, match in enumerate(fused, start=1):
            sources = [
                RankingSourceEvidence(
                    source_index=index,
                    rank=source_rank,
                    score=source_score,
                    contribution=1.0 / (self.config.k + source_rank),
                )
                for index, items in enumerate(branch_items)
                if (source := items.get(match.chunk.chunk_id)) is not None
                for source_rank, source_score in [source]
            ]
            results.append(
                RankingResultEvidence(
                    id=match.chunk.chunk_id,
                    rank=rank,
                    score=match.score,
                    sources=sources,
                )
            )
        return RankingEvidence(
            method="reciprocal_rank_fusion",
            score_label="RRF score",
            formula=f"1 / ({self.config.k} + rank)",
            results=results,
        )
