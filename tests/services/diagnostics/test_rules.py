"""Unit tests for each diagnostic rule (the lowest layer a bug appears).

Rules are pure functions of a `DiagnosticContext`, so they are tested against
hand-tweaked resolved settings rather than a live pipeline run.
"""

from __future__ import annotations

import dataclasses
from uuid import uuid4

from app.db import models
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.settings import IndexTarget
from app.pipelines.validation import PipelineValidationResult
from app.schemas.enums import IndexBackend
from app.services.diagnostics.rules.data import IndexProbeRule
from app.services.diagnostics.rules.embedding import (
    EmbeddingConnectionMismatchRule,
    EmbeddingDimensionMismatchRule,
    EmbeddingModelMismatchRule,
)
from app.services.diagnostics.rules.indexing import (
    BackendMismatchRule,
    Bm25IndexMismatchRule,
    DenseIndexMismatchRule,
    HybridTargetMismatchRule,
    NamespaceMismatchRule,
)
from app.services.diagnostics.rules.node_config import NodeConfigRule
from app.services.diagnostics.rules.runs import (
    RecentIngestionFailuresRule,
    RecentRetrievalFailuresRule,
)
from app.vectorstores.base import IndexStats
from tests.services.diagnostics.helpers import StubProber, make_context

replace = dataclasses.replace


# -- embedding model mismatch (the flagship, red-green) --------------------


def test_embedding_model_mismatch_flagged(base_ingestion, base_retrieval):
    """Different model names on the two sides is a confirmed error."""
    ctx = make_context(
        ingestion=replace(base_ingestion, embedding_model="model-a"),
        retrieval=replace(base_retrieval, embedding_model="model-b"),
    )
    findings = EmbeddingModelMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "error"
    assert findings[0].confidence == "confirmed"
    assert findings[0].code == "embedding_model_mismatch"


def test_embedding_model_match_is_clean(base_ingestion, base_retrieval):
    """Matching model names produce no finding (the green side)."""
    ctx = make_context(
        ingestion=replace(base_ingestion, embedding_model="same"),
        retrieval=replace(base_retrieval, embedding_model="same"),
    )
    assert EmbeddingModelMismatchRule().evaluate(ctx) == []


def test_embedding_model_rule_silent_when_a_side_missing(base_retrieval):
    """A single resolved side cannot be compared, so the rule stays silent."""
    ctx = make_context(retrieval=base_retrieval)
    assert EmbeddingModelMismatchRule().evaluate(ctx) == []


# -- embedding connection mismatch -----------------------------------------


def test_connection_mismatch_is_warning_heuristic(base_ingestion, base_retrieval):
    """Same model, different connections -> warning/heuristic, not error."""
    ctx = make_context(
        ingestion=replace(base_ingestion, embedding_model="m", embedding_connection_id=uuid4()),
        retrieval=replace(base_retrieval, embedding_model="m", embedding_connection_id=uuid4()),
    )
    findings = EmbeddingConnectionMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "warning"
    assert findings[0].confidence == "heuristic"


def test_connection_mismatch_silent_when_model_differs(base_ingestion, base_retrieval):
    """A model-name mismatch is the model rule's job, not the connection rule's."""
    ctx = make_context(
        ingestion=replace(base_ingestion, embedding_model="a", embedding_connection_id=uuid4()),
        retrieval=replace(base_retrieval, embedding_model="b", embedding_connection_id=uuid4()),
    )
    assert EmbeddingConnectionMismatchRule().evaluate(ctx) == []


# -- embedding dimension mismatch ------------------------------------------


def test_dimension_mismatch_flagged_when_both_set(base_ingestion, base_retrieval):
    """Two explicit, differing dimensions is a confirmed error."""
    ctx = make_context(
        ingestion=replace(base_ingestion, dimension=1536),
        retrieval=replace(base_retrieval, dimension=768),
    )
    findings = EmbeddingDimensionMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "error"


def test_dimension_rule_silent_when_either_side_none(base_ingestion, base_retrieval):
    """A None dimension on either side means no guess, no finding."""
    ctx = make_context(
        ingestion=replace(base_ingestion, dimension=None),
        retrieval=replace(base_retrieval, dimension=768),
    )
    assert EmbeddingDimensionMismatchRule().evaluate(ctx) == []


# -- backend / index / namespace / hybrid ----------------------------------


def test_backend_mismatch_flagged(base_ingestion, base_retrieval):
    """Differing backends is a confirmed backend_storage error."""
    ctx = make_context(
        ingestion=replace(base_ingestion, backend=IndexBackend.PGVECTOR),
        retrieval=replace(base_retrieval, backend=IndexBackend.PINECONE),
    )
    findings = BackendMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].category == "backend_storage"


def test_dense_index_mismatch_flagged(base_ingestion, base_retrieval):
    """Differing dense index names is a confirmed error."""
    ctx = make_context(
        ingestion=replace(base_ingestion, index_name="idx-a"),
        retrieval=replace(base_retrieval, index_name="idx-b"),
    )
    findings = DenseIndexMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "error"


def test_bm25_index_mismatch_flagged(base_ingestion, base_retrieval):
    """Differing sparse index names on both sides is a warning."""
    ing = replace(
        base_ingestion,
        index_targets=(
            IndexTarget(IndexBackend.PGVECTOR, "idx", "dense"),
            IndexTarget(IndexBackend.PGVECTOR, "idx-bm25", "sparse"),
        ),
    )
    ret = replace(
        base_retrieval,
        index_targets=(
            IndexTarget(IndexBackend.PGVECTOR, "idx", "dense"),
            IndexTarget(IndexBackend.PGVECTOR, "other-bm25", "sparse"),
        ),
    )
    ctx = make_context(ingestion=ing, retrieval=ret)
    findings = Bm25IndexMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "warning"


def test_namespace_mismatch_only_on_pinecone(base_ingestion, base_retrieval):
    """Namespace differences are flagged for Pinecone, ignored for pgvector."""
    pinecone_ctx = make_context(
        ingestion=replace(base_ingestion, backend=IndexBackend.PINECONE, namespace="a"),
        retrieval=replace(base_retrieval, backend=IndexBackend.PINECONE, namespace="b"),
    )
    assert len(NamespaceMismatchRule().evaluate(pinecone_ctx)) == 1

    pgvector_ctx = make_context(
        ingestion=replace(base_ingestion, backend=IndexBackend.PGVECTOR, namespace="a"),
        retrieval=replace(base_retrieval, backend=IndexBackend.PGVECTOR, namespace="b"),
    )
    assert NamespaceMismatchRule().evaluate(pgvector_ctx) == []


def test_hybrid_target_mismatch_flagged(base_ingestion, base_retrieval):
    """Ingestion writing dense+sparse but retrieval reading dense is a warning."""
    ing = replace(
        base_ingestion,
        index_targets=(
            IndexTarget(IndexBackend.PGVECTOR, "idx", "dense"),
            IndexTarget(IndexBackend.PGVECTOR, "idx-bm25", "sparse"),
        ),
    )
    ret = replace(
        base_retrieval,
        index_targets=(IndexTarget(IndexBackend.PGVECTOR, "idx", "dense"),),
    )
    ctx = make_context(ingestion=ing, retrieval=ret)
    findings = HybridTargetMismatchRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].confidence == "heuristic"


# -- node config mapping ----------------------------------------------------


def test_node_config_maps_validation_issues(base_ingestion):
    """Each single-pipeline validation issue becomes a diagnostic, severity kept."""
    result = PipelineValidationResult(
        valid=False,
        errors=["bad"],
        warnings=[],
        issues=[
            PipelineValidationIssue(
                message="Embedder missing model", severity="error", node_id="embed"
            )
        ],
    )
    ctx = make_context(ingestion=base_ingestion, ingestion_validation=result)
    findings = NodeConfigRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].severity == "error"
    assert findings[0].summary == "Embedder missing model"
    assert findings[0].resources[0].kind == "node"


# -- run failures -----------------------------------------------------------


def _failed_run(kind: models.PipelineKind) -> models.PipelineRun:
    return models.PipelineRun(
        pipeline_id=uuid4(),
        kind=kind,
        user_id=uuid4(),
        collection_id=uuid4(),
        status=models.PipelineRunStatus.FAILED,
    )


def test_recent_ingestion_failures_link_runs():
    """Recent failed ingestion runs are summarized with trace links."""
    runs = [_failed_run(models.PipelineKind.INGESTION)]
    ctx = make_context(recent_ingestion_failures=runs)
    findings = RecentIngestionFailuresRule().evaluate(ctx)
    assert len(findings) == 1
    assert findings[0].category == "run_failures"
    assert findings[0].links[0].route == f"/traces/runs/{runs[0].id}"


def test_recent_retrieval_failures_empty_is_clean():
    """No failures -> no finding."""
    assert RecentRetrievalFailuresRule().evaluate(make_context()) == []


# -- probe rule (category C) -----------------------------------------------


def test_probe_missing_index_is_error(base_retrieval):
    """A probe reporting the index absent is a confirmed error."""
    prober = StubProber(IndexStats(exists=False, count=0))
    ctx = make_context(retrieval=base_retrieval, prober=prober)
    findings = IndexProbeRule().evaluate(ctx)
    assert any(f.code == "missing_index" and f.severity == "error" for f in findings)


def test_probe_empty_index_is_warning(base_retrieval):
    """An existing but empty index is a warning."""
    prober = StubProber(IndexStats(exists=True, count=0))
    ctx = make_context(retrieval=base_retrieval, prober=prober)
    findings = IndexProbeRule().evaluate(ctx)
    assert any(f.code == "empty_index" and f.severity == "warning" for f in findings)


def test_probe_unavailable_degrades_to_info(base_retrieval):
    """An unreachable store degrades to an info/heuristic finding, never raises."""
    prober = StubProber(unavailable=True)
    ctx = make_context(retrieval=base_retrieval, prober=prober)
    findings = IndexProbeRule().evaluate(ctx)
    assert findings
    assert all(f.severity == "info" and f.confidence == "heuristic" for f in findings)
    assert all(f.code == "index_status_unavailable" for f in findings)


class TestBackendCapabilityRule:
    """Nodes pointed at a backend that cannot serve them."""

    def test_a_facet_node_on_pinecone_is_an_error_naming_the_node(
        self, base_retrieval: PipelineSettings
    ) -> None:
        """The finding lists the offending node, not just the backend.

        A bare "incompatible backend" leaves the user guessing which of a
        dozen nodes to change.
        """
        from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
        from app.services.diagnostics.rules.compatibility import BackendCapabilityRule

        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="facet",
                    type="facet.bm25",
                    name="Facet",
                    config={
                        "backend": "pinecone",
                        "index_name": "remote",
                        "field": "document_id",
                    },
                )
            ]
        )
        ctx = make_context(retrieval=base_retrieval, retrieval_definition=definition)

        findings = BackendCapabilityRule().evaluate(ctx)

        assert [finding.code for finding in findings] == ["backend_capability_unsupported"]
        assert findings[0].severity == "error"
        assert any("facet" in observation.value for observation in findings[0].observations)

    def test_a_supported_graph_produces_nothing(
        self, base_retrieval: PipelineSettings
    ) -> None:
        from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
        from app.services.diagnostics.rules.compatibility import BackendCapabilityRule

        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="facet",
                    type="facet.bm25",
                    name="Facet",
                    config={
                        "backend": "pgvector",
                        "index_name": "docs-bm25",
                        "field": "document_id",
                    },
                )
            ]
        )
        ctx = make_context(retrieval=base_retrieval, retrieval_definition=definition)

        assert BackendCapabilityRule().evaluate(ctx) == []

    def test_an_unresolved_side_is_skipped(self) -> None:
        """A collection with no bound pipeline has nothing to check."""
        from app.services.diagnostics.rules.compatibility import BackendCapabilityRule

        assert BackendCapabilityRule().evaluate(make_context()) == []
