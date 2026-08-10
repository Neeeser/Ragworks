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
from app.schemas.models import SamplingSupport


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


def test_sampling_support_is_measured_per_model() -> None:
    """It does not follow the version — gpt-5.4 takes `temperature` where
    gpt-5.5 needs reasoning off and gpt-5 never takes it — so it is probed at
    generation rather than inferred, and the classes must survive a refresh."""
    models = load_openai_bundle().models

    assert models["gpt-4.1"].capabilities().sampling is SamplingSupport.ALWAYS
    assert models["gpt-5.4-nano"].capabilities().sampling is SamplingSupport.WITHOUT_REASONING
    assert models["o4-mini"].capabilities().sampling is SamplingSupport.NEVER


def test_an_unprobed_model_stays_permissive() -> None:
    """Premium-priced models are left unprobed so a refresh costs nothing;
    they must keep their knobs rather than lose them to a missing measurement."""
    entry = load_openai_bundle().models["gpt-5-pro"]

    assert entry.sampling is None
    assert entry.capabilities().sampling is SamplingSupport.ALWAYS


def test_effort_none_comes_from_the_probe_without_losing_documented_levels() -> None:
    """gpt-5.6-luna accepts `none` but its docs page never says so; merging the
    probe into the parsed list would have dropped low/medium/high with it."""
    entry = load_openai_bundle().models["gpt-5.6-luna"]

    assert entry.supports_effort_none is True
    assert entry.effort_options()[0] == "none"
    assert "high" in entry.effort_options()
