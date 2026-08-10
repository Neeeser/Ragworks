"""Per-token pricing looked up from a provider's own model catalog.

Dollars are reported only where the provider publishes per-token prices
(OpenRouter's catalog does; most others publish nothing), so `usd_cost`
answers `None` rather than inventing a number. The lookup reads the adapter's
catalog, which every adapter serves from its process cache — never call it on
a render path, only from the job that spent the tokens.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.schemas.enums import ProviderKind
from app.schemas.models import ModelPricing

if TYPE_CHECKING:
    from app.providers.base import ProviderAdapter


def catalog_pricing(
    adapter: ProviderAdapter, kind: ProviderKind, model_id: str
) -> ModelPricing | None:
    """Return the catalog's pricing for one model, or None when unpublished.

    Any catalog failure reads as "no pricing": usage reporting must never
    fail the job whose spend it is describing.
    """
    try:
        catalog = adapter.list_models(kind)
    except Exception:  # an unreachable provider prices nothing
        return None
    for model in catalog.models:
        if model.id == model_id:
            return model.pricing
    return None


def usd_cost(
    pricing: ModelPricing | None,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
) -> float | None:
    """Multiply token counts by published per-token prices.

    None when nothing priced applies — no pricing block, unparseable prices,
    or no tokens on a side the provider prices. A side the provider prices at
    zero (a free model) contributes a real zero.
    """
    if pricing is None:
        return None
    total = 0.0
    priced = False
    for tokens, price in (
        (prompt_tokens, pricing.prompt),
        (completion_tokens, pricing.completion),
    ):
        rate = _rate(price)
        if tokens is None or rate is None:
            continue
        total += tokens * rate
        priced = True
    return total if priced else None


def _rate(price: str | None) -> float | None:
    """Parse a catalog's per-token price string into a float."""
    if price is None:
        return None
    try:
        return float(price)
    except ValueError:
        return None
