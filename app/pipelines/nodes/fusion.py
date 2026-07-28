"""Fusion nodes: combine several retrieval result streams into one.

`BaseFusionNode` owns the take-many-emit-one shape — a single variadic
`items` input port (`accepts_many`) that the executor delivers as a list of
`ItemBatch`es, one per inbound edge — so every fusion strategy (RRF
today; weighted/alpha blending later) only implements `fuse()` over the
collected match lists. Usage is summed across branches.
"""

from __future__ import annotations

import builtins
from abc import abstractmethod

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    RankingEvidence,
    RankingResultEvidence,
    RankingSourceEvidence,
    combine_usage,
    summarize_match_order,
    summarize_matches,
)
from app.retrieval.models import ScoredChunk


class FusionConfig(BaseModel):
    """Base configuration for fusion nodes."""


class BaseFusionNode(PipelineNodeBase[FusionConfig]):
    """Shared fusion behavior: collect N result streams, emit one."""

    category = "retrieval"
    input_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            requires=(Facet.SCORE,),
            accepts_many=True,
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            adds=(Facet.SCORE,),
            preserves=True,
        ),
    )
    config_model: builtins.type[FusionConfig] = FusionConfig

    @abstractmethod
    def fuse(
        self,
        branches: list[list[ScoredChunk]],
        context: PipelineRunContext,
    ) -> list[ScoredChunk]:
        """Combine per-branch match lists into one fused, ordered list."""

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Fuse every inbound result stream into a single stream."""
        batches = self._collect_batches(inputs)
        fused = self.fuse([batch.preview_matches() for batch in batches], context)
        return {
            "items": ItemBatch.from_matches(
                fused,
                usage=combine_usage([batch.usage for batch in batches]),
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize per-branch orders and the fused order."""
        batches = self._collect_batches(inputs)
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label=f"Branch {index} order",
                    value=summarize_match_order(batch.preview_matches()),
                )
                for index, batch in enumerate(batches, start=1)
            ]
            + [
                NodeTraceValue(
                    label=f"Branch {index} items",
                    value=trace_items(batch.items),
                    kind="items",
                )
                for index, batch in enumerate(batches, start=1)
            ],
            outputs=[
                NodeTraceValue(
                    label="Matches",
                    value=summarize_matches(output_batch.preview_matches(), limit=10),
                ),
                NodeTraceValue(
                    label="Fused order",
                    value=summarize_match_order(output_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Fused items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
                NodeTraceValue(
                    label="Ranking evidence",
                    value=self._ranking_evidence(
                        [batch.preview_matches() for batch in batches],
                        output_batch.preview_matches(),
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
    def _collect_batches(inputs: dict[str, object]) -> list[ItemBatch]:
        """Validate the variadic `items` input into typed batches.

        The executor always delivers an `accepts_many` port as a list; a bare
        batch is tolerated for direct node-level callers (tests).
        """
        raw = inputs.get("items")
        values = raw if isinstance(raw, list) else [raw]
        return [ItemBatch.model_validate(value) for value in values]


class RRFusionConfig(FusionConfig):
    """Configuration for reciprocal rank fusion.

    `k` is the standard RRF dampening constant (Cormack et al.: 60): higher
    values flatten the difference between ranks. Fusion never truncates —
    cutting the fused list is the Result Limit node's job (`limit.results`), so the
    cut is always an explicit, traced step.
    """

    k: int = Field(
        default=60,
        ge=1,
        title="Rank dampening (k)",
        description=(
            "Smoothing constant in the RRF score, 1 / (k + rank), summed "
            "across every branch a chunk appears in. It sets how steeply "
            "early ranks outweigh late ones: at k=1 a rank-1 hit scores 25x "
            "a rank-49 hit; at the standard k=60, about 1.8x — so appearing "
            "in several branches counts for more than winning any single "
            "one. Fusion emits every fused candidate; Result Limit cuts."
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
    example = "[semantic: (a, b), bm25: (b, c)] -> Items(b, a, c)."
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
        list is the Result Limit node's job.
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
