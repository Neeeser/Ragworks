"""Catalog-published pricing turned into dollars, or nothing at all."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.providers.base import CatalogResult
from app.providers.pricing import catalog_pricing, usd_cost
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import ModelPricing
from app.schemas.providers import CatalogMetadata, CatalogModel


class _StubAdapter:
    """A provider adapter serving one catalog, or refusing to."""

    def __init__(self, models: list[CatalogModel], *, fails: bool = False) -> None:
        self._models = models
        self._fails = fails

    def list_models(self, kind: ProviderKind, *, force_refresh: bool = False) -> CatalogResult:
        del kind, force_refresh
        if self._fails:
            raise RuntimeError("provider unreachable")
        return CatalogResult(models=self._models, meta=CatalogMetadata())


def _model(model_id: str, pricing: ModelPricing | None) -> CatalogModel:
    return CatalogModel(
        connection_id=uuid4(),
        connection_label="conn",
        provider_type=ProviderType.OPENROUTER,
        id=model_id,
        name=model_id,
        pricing=pricing,
    )


def test_pricing_comes_from_the_matching_catalog_entry() -> None:
    adapter = _StubAdapter(
        [
            _model("other/model", ModelPricing(prompt="0.001")),
            _model("openai/text-embedding-3-small", ModelPricing(prompt="0.00000002")),
        ]
    )
    pricing = catalog_pricing(adapter, ProviderKind.EMBEDDING, "openai/text-embedding-3-small")
    assert pricing is not None
    assert pricing.prompt == "0.00000002"


def test_an_unreachable_catalog_prices_nothing_rather_than_raising() -> None:
    adapter = _StubAdapter([], fails=True)
    assert catalog_pricing(adapter, ProviderKind.CHAT, "any/model") is None


def test_unknown_model_has_no_pricing() -> None:
    adapter = _StubAdapter([_model("a/b", ModelPricing(prompt="0.1"))])
    assert catalog_pricing(adapter, ProviderKind.CHAT, "c/d") is None


def test_cost_multiplies_both_priced_sides() -> None:
    pricing = ModelPricing(prompt="0.000001", completion="0.000002")
    assert usd_cost(pricing, prompt_tokens=1000, completion_tokens=500) == pytest.approx(0.002)


def test_a_free_model_costs_a_real_zero() -> None:
    assert usd_cost(ModelPricing(prompt="0"), prompt_tokens=12_000) == 0.0


def test_no_published_pricing_yields_no_dollars() -> None:
    assert usd_cost(None, prompt_tokens=1000) is None
    assert usd_cost(ModelPricing(), prompt_tokens=1000) is None
    assert usd_cost(ModelPricing(prompt="free"), prompt_tokens=1000) is None


def test_an_unpriced_side_contributes_nothing() -> None:
    pricing = ModelPricing(prompt="0.000001")
    assert usd_cost(pricing, prompt_tokens=1000, completion_tokens=999) == pytest.approx(0.001)
    assert usd_cost(pricing, completion_tokens=999) is None
