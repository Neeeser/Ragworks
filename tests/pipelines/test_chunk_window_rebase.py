"""Regression tests for the additive-overlap chunk window rebase (schema v4)."""

from __future__ import annotations

from typing import Any

from app.pipelines.chunk_window_upgrade import rebase_chunk_windows
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition


def _definition(config: dict[str, Any], node_type: str = "chunker.token") -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[PipelineNodeDefinition(id="chunk", type=node_type, name="C", config=config)],
        edges=[],
    )


def _config(definition: PipelineDefinition) -> dict[str, Any]:
    return definition.nodes[0].config or {}


def test_rebased_size_preserves_the_window_the_pipeline_already_emitted() -> None:
    """A stored 496/99 meant 496-token chunks; it must still mean 496."""
    config = _config(rebase_chunk_windows(_definition({"chunk_size": 496, "chunk_overlap": 99})))

    assert config["chunk_size"] == 397
    assert config["chunk_overlap"] == 99
    # The number reaching the embedder is unchanged, which is the whole point.
    assert config["chunk_size"] + config["chunk_overlap"] == 496


def test_zero_overlap_is_left_alone() -> None:
    """Without overlap the two meanings coincide, so there is nothing to rebase."""
    config = _config(rebase_chunk_windows(_definition({"chunk_size": 512, "chunk_overlap": 0})))

    assert config["chunk_size"] == 512


def test_expression_values_are_left_alone() -> None:
    """An expression resolves per run, so there is no literal to rebase."""
    config: dict[str, Any] = {"chunk_size": {"$expr": "top_k * 8"}, "chunk_overlap": 99}

    assert _config(rebase_chunk_windows(_definition(config))) == config


def test_overlap_at_or_above_the_size_pins_the_size_positive() -> None:
    """Rebasing must never produce a size the chunker rejects."""
    config = _config(rebase_chunk_windows(_definition({"chunk_size": 64, "chunk_overlap": 64})))

    assert config["chunk_size"] == 1


def test_non_chunker_nodes_are_untouched() -> None:
    config: dict[str, Any] = {"chunk_size": 496, "chunk_overlap": 99}

    assert _config(rebase_chunk_windows(_definition(config, "embedder.text"))) == config


def test_a_current_definition_is_never_rebased_twice() -> None:
    """Re-running would shrink every window again on each boot.

    The guard is the stored `schema_version`, so a definition written by the
    running code carries the current version and is skipped entirely — this
    pins that the current version is past the rebase gate.
    """
    from app.services.pipeline_upgrades import CHUNK_WINDOW_SCHEMA_VERSION

    assert PipelineDefinition(nodes=[], edges=[]).schema_version >= CHUNK_WINDOW_SCHEMA_VERSION
