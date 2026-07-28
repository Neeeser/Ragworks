"""Guard test for the shipped OpenAI model bundle.

The bundle is generated (`make refresh-openai-bundle`) from OpenAI's docs
pages; this test pins the parsed shape and a handful of values known from the
live pages, so a regeneration under a shifted docs format — a renamed details
bullet, a restructured endpoints table — fails the gate loudly instead of
shipping a bundle full of nulls.
"""

from __future__ import annotations

from app.providers.openai_bundle import (
    DEFAULT_REASONING_EFFORTS,
    load_openai_bundle,
)


def test_bundle_parses_and_covers_the_core_families() -> None:
    bundle = load_openai_bundle()
    for model_id in ("gpt-4.1", "gpt-4o", "o4-mini", "text-embedding-3-small"):
        assert model_id in bundle.models, f"{model_id} missing from bundle"


def test_known_values_survive_regeneration() -> None:
    models = load_openai_bundle().models

    gpt41 = models["gpt-4.1"]
    assert gpt41.context_window == 1_047_576
    assert gpt41.max_output_tokens == 32_768
    assert gpt41.reasoning is False
    assert gpt41.endpoints.responses is True
    assert gpt41.function_calling is True

    o4_mini = models["o4-mini"]
    assert o4_mini.reasoning is True
    assert o4_mini.effort_options() == list(DEFAULT_REASONING_EFFORTS)

    embedding = models["text-embedding-3-small"]
    assert embedding.endpoints.embeddings is True
    assert embedding.endpoints.chat_completions is False


def test_a_regeneration_that_parses_nothing_cannot_pass() -> None:
    """Numbers must actually parse — a docs-format shift yields nulls."""
    models = load_openai_bundle().models
    with_context = [m for m in models.values() if m.context_window is not None]
    assert len(with_context) >= 20
    with_efforts = [m for m in models.values() if m.reasoning_efforts]
    assert with_efforts, "no model parsed an explicit reasoning-effort list"


def test_snapshot_ids_resolve_to_their_base_entry() -> None:
    bundle = load_openai_bundle()
    base = bundle.models["gpt-4.1"]
    assert bundle.lookup("gpt-4.1-2025-04-14") is base
    assert bundle.lookup("gpt-4.1") is base
    assert bundle.lookup("some-model-nobody-shipped") is None
