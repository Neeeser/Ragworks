"""Embedding-compatibility rules: the flagship diagnostics.

The motivating incident: an ingestion pipeline is re-pointed at a different
embedding model while retrieval keeps the old one, so indexed vectors and query
vectors live in different spaces and search silently returns nonsense. These
rules compare the two resolved sides and flag the mismatch.
"""

from __future__ import annotations

from app.schemas.diagnostics import CollectionDiagnostic, DiagnosticAction, DiagnosticCategory
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.rules.base import (
    build_diagnostic,
    paired_observation,
    pipeline_builder_route,
    pipeline_resource,
)

_CATEGORY: DiagnosticCategory = "embedding"


class EmbeddingModelMismatchRule:
    """Ingestion and retrieval embed with different model names (error)."""

    code = "embedding_model_mismatch"
    category: DiagnosticCategory = _CATEGORY

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag a confirmed model-name mismatch between the two sides."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        if ingestion.embedding_model == retrieval.embedding_model:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="error",
                confidence="confirmed",
                category=self.category,
                title="Embedding models differ",
                summary=(
                    "Ingestion indexes with one embedding model while retrieval "
                    "queries with another. Indexed vectors and query vectors live "
                    "in different spaces, so search results are not meaningful. "
                    "Re-ingest after aligning the models, or align retrieval to "
                    "the model the data was indexed with."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation(
                        "Embedding model",
                        ingestion.embedding_model,
                        retrieval.embedding_model,
                    )
                ],
                action=DiagnosticAction(
                    label="Edit search tool",
                    route=pipeline_builder_route("retrieval"),
                ),
            )
        ]


class EmbeddingConnectionMismatchRule:
    """Same model name, different provider connections (warning/heuristic)."""

    code = "embedding_connection_mismatch"
    category: DiagnosticCategory = _CATEGORY

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag a model match on differing connections as a drift risk."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        same_model = ingestion.embedding_model == retrieval.embedding_model
        differing_connection = (
            ingestion.embedding_connection_id != retrieval.embedding_connection_id
        )
        if not same_model or not differing_connection:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="warning",
                confidence="heuristic",
                category=self.category,
                title="Same embedding model on different connections",
                summary=(
                    "Both sides use the same model name but different provider "
                    "connections (e.g. two Ollama servers). The vectors are "
                    "likely compatible, but the two setups can drift apart, so "
                    "this is a risk flag rather than a confirmed error."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation(
                        "Connection",
                        ingestion.embedding_connection_id,
                        retrieval.embedding_connection_id,
                    )
                ],
            )
        ]


class EmbeddingDimensionMismatchRule:
    """Explicit ingestion vs retrieval dimensions differ (error).

    Only fires when *both* sides carry an explicit dimension. A `None` on
    either side is the common case (dimensions are never sent unless the user
    configured one), and guessing would overclaim -- so the rule stays silent.
    """

    code = "embedding_dimension_mismatch"
    category: DiagnosticCategory = _CATEGORY

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag a confirmed dimension mismatch when both sides are set."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        if ingestion.dimension is None or retrieval.dimension is None:
            return []
        if ingestion.dimension == retrieval.dimension:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="error",
                confidence="confirmed",
                category=self.category,
                title="Embedding dimensions differ",
                summary=(
                    "The ingestion indexer and the retrieval embedder declare "
                    "different vector dimensions. Queries cannot match the "
                    "indexed vectors. Align the dimensions and re-ingest."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation(
                        "Dimension",
                        ingestion.dimension,
                        retrieval.dimension,
                    )
                ],
                action=DiagnosticAction(
                    label="Edit ingestion pipeline",
                    route=pipeline_builder_route("ingestion"),
                ),
            )
        ]
