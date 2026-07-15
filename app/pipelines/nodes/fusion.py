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
from app.pipelines.tracing.summaries import combine_usage, summarize_match_order, trace_match_items
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
                    label="Fused order",
                    value=summarize_match_order(output_payload.response.matches),
                ),
                NodeTraceValue(
                    label="Fused items",
                    value=trace_match_items(output_payload.response.matches),
                    kind="items",
                ),
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
    values flatten the difference between ranks. `top_k` caps the fused list;
    unset, it falls back to the run's requested top_k.
    """

    k: int = Field(default=60, ge=1)
    top_k: int | None = Field(default=None, gt=0)


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
        values are not comparable.
        """
        scores: dict[str, float] = {}
        first_seen: dict[str, ScoredChunk] = {}
        for matches in branches:
            for rank, match in enumerate(matches, start=1):
                chunk_id = match.chunk.chunk_id
                scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (self.config.k + rank)
                first_seen.setdefault(chunk_id, match)
        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        # Explicit None checks: a top_k of 0 means zero results, never
        # "unset — return every fused chunk".
        if self.config.top_k is not None:
            limit = self.config.top_k
        elif context.top_k is not None:
            limit = max(context.top_k, 0)
        else:
            limit = len(ordered)
        return [
            ScoredChunk(chunk=first_seen[chunk_id].chunk, score=score)
            for chunk_id, score in ordered[:limit]
        ]
