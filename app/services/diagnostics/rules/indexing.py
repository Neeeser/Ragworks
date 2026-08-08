"""Index/backend-compatibility rules comparing the two resolved sides.

Where the embedding rules catch a vector-space mismatch, these catch a
storage-location mismatch: retrieval reading an index (or namespace, or
backend) that ingestion never wrote to. All read the resolved settings' index
targets, never a raw config dict.
"""

from __future__ import annotations

from app.db.repositories import RegisteredIndexRepository
from app.pipelines.settings import IndexTarget, PipelineSettings
from app.schemas.diagnostics import (
    CollectionDiagnostic,
    DiagnosticAction,
    DiagnosticCategory,
    DiagnosticObservation,
)
from app.schemas.enums import IndexBackend
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.rules.base import (
    PipelineSide,
    build_diagnostic,
    paired_observation,
    pipeline_builder_route,
    pipeline_resource,
)


def _target_of(targets: tuple[IndexTarget, ...], vector_type: str) -> IndexTarget | None:
    """Return the first index target of a vector type, if the side has one."""
    return next((t for t in targets if t.vector_type == vector_type), None)


class BackendMismatchRule:
    """Ingestion and retrieval use different vector-store backends (error)."""

    code = "backend_mismatch"
    category: DiagnosticCategory = "backend_storage"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag differing backends -- retrieval cannot read ingestion's store."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        if ingestion.backend == retrieval.backend:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="error",
                confidence="confirmed",
                category=self.category,
                title="Vector-store backends differ",
                summary=(
                    "Ingestion writes to one vector-store backend and retrieval "
                    "reads from another, so retrieval sees none of the indexed "
                    "data. Point both pipelines at the same backend."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation("Backend", ingestion.backend.value, retrieval.backend.value)
                ],
                action=DiagnosticAction(
                    label="Edit search tool",
                    route=pipeline_builder_route("retrieval"),
                ),
            )
        ]


class DenseIndexMismatchRule:
    """Dense index names differ between the sides (error)."""

    code = "dense_index_mismatch"
    category: DiagnosticCategory = "index_config"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag differing dense index names -- retrieval reads an empty index."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        if ingestion.index_name == retrieval.index_name:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="error",
                confidence="confirmed",
                category=self.category,
                title="Dense index names differ",
                summary=(
                    "Retrieval queries a different dense index than ingestion "
                    "wrote to, so it reads nothing ingestion produced. Align the "
                    "index names on both sides."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation("Dense index", ingestion.index_name, retrieval.index_name)
                ],
                action=DiagnosticAction(
                    label="Edit search tool",
                    route=pipeline_builder_route("retrieval"),
                ),
            )
        ]


class Bm25IndexMismatchRule:
    """Sparse/BM25 sibling index names differ (warning)."""

    code = "bm25_index_mismatch"
    category: DiagnosticCategory = "index_config"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag differing sparse index names when both sides have a sparse plane."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        ing_sparse = _target_of(ingestion.index_targets, "sparse")
        ret_sparse = _target_of(retrieval.index_targets, "sparse")
        if ing_sparse is None or ret_sparse is None:
            return []
        if ing_sparse.index_name == ret_sparse.index_name:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="warning",
                confidence="confirmed",
                category=self.category,
                title="BM25 index names differ",
                summary=(
                    "The sparse (BM25) index names differ between ingestion and "
                    "retrieval, so the lexical half of hybrid search reads a "
                    "different index than was written."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation("BM25 index", ing_sparse.index_name, ret_sparse.index_name)
                ],
                action=DiagnosticAction(
                    label="Edit search tool",
                    route=pipeline_builder_route("retrieval"),
                ),
            )
        ]


class NamespaceMismatchRule:
    """Pinecone namespaces differ between the sides (error)."""

    code = "namespace_mismatch"
    category: DiagnosticCategory = "index_config"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag differing namespaces -- only meaningful on Pinecone."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        if ingestion.backend != IndexBackend.PINECONE or retrieval.backend != IndexBackend.PINECONE:
            return []
        if ingestion.namespace == retrieval.namespace:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="error",
                confidence="confirmed",
                category=self.category,
                title="Pinecone namespaces differ",
                summary=(
                    "Ingestion and retrieval use different Pinecone namespaces "
                    "within the same index, so retrieval reads an empty "
                    "namespace. Align the namespaces on both sides."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation("Namespace", ingestion.namespace, retrieval.namespace)
                ],
                action=DiagnosticAction(
                    label="Edit search tool",
                    route=pipeline_builder_route("retrieval"),
                ),
            )
        ]


class HybridTargetMismatchRule:
    """The two sides cover a different set of index planes (warning/heuristic)."""

    code = "hybrid_target_mismatch"
    category: DiagnosticCategory = "pipeline_compatibility"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag e.g. ingestion writing dense+sparse but retrieval reading dense."""
        ingestion = ctx.ingestion_settings
        retrieval = ctx.retrieval_settings
        if ingestion is None or retrieval is None:
            return []
        ing_types = {t.vector_type for t in ingestion.index_targets}
        ret_types = {t.vector_type for t in retrieval.index_targets}
        if ing_types == ret_types:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="warning",
                confidence="heuristic",
                category=self.category,
                title="Index planes differ",
                summary=(
                    "Ingestion and retrieval cover different index planes (dense "
                    "vs sparse/BM25). Part of what one side writes or expects is "
                    "not served by the other -- hybrid search may silently fall "
                    "back to a single plane."
                ),
                resources=[
                    pipeline_resource(ctx, "ingestion"),
                    pipeline_resource(ctx, "retrieval"),
                ],
                observations=[
                    paired_observation(
                        "Index planes",
                        ", ".join(sorted(ing_types)),
                        ", ".join(sorted(ret_types)),
                    )
                ],
            )
        ]


class IndexDimensionMismatchRule:
    """A side's stated dimension differs from its registered index (error).

    Bind-time validation now refuses this pairing, but bindings made before
    that gate existed (or edited around it) still resolve — and the failure
    they produce is invisible: the dense branch returns nothing at query time
    while ingest fails per-document at upsert. Only fires when the pipeline
    states a dimension and the registered index records one.
    """

    code = "index_dimension_mismatch"
    category: DiagnosticCategory = "index_config"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Compare each side's dimension against its dense index's record."""
        sides: tuple[tuple[PipelineSide, PipelineSettings | None], ...] = (
            ("ingestion", ctx.ingestion_settings),
            ("retrieval", ctx.retrieval_settings),
        )
        indexes = RegisteredIndexRepository(ctx.session)
        findings: list[CollectionDiagnostic] = []
        for side, settings in sides:
            if settings is None or settings.dimension is None:
                continue
            target = _target_of(settings.index_targets, "dense")
            if target is None:
                continue
            row = indexes.find_by_identity(ctx.user.id, target.backend, target.index_name)
            if row is None or row.dimension is None or row.dimension == settings.dimension:
                continue
            findings.append(
                build_diagnostic(
                    code=self.code,
                    severity="error",
                    confidence="confirmed",
                    category=self.category,
                    title="Index dimension differs from the pipeline",
                    summary=(
                        f"The {side} pipeline produces {settings.dimension}-"
                        f"dimensional vectors, but its index '{row.name}' stores "
                        f"{row.dimension}. Queries match nothing and ingest "
                        "rejects every document; pick an index of the right "
                        "width or re-create this one."
                    ),
                    resources=[pipeline_resource(ctx, side)],
                    observations=[
                        DiagnosticObservation(
                            label="Pipeline dimension", value=str(settings.dimension)
                        ),
                        DiagnosticObservation(
                            label=f"Index '{row.name}'", value=str(row.dimension)
                        ),
                    ],
                    action=DiagnosticAction(
                        label=f"Edit {side} pipeline",
                        route=pipeline_builder_route(side),
                    ),
                )
            )
        return findings
