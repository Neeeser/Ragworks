"""Typed usage accounting for chat completions.

`UsageSummary` is the one parse of a provider's chat usage payload: the chat
run loop, eval generation, and the usage ledger's capture point all read it,
so a provider field one of them handles is handled for all three. The
coercion helpers are module functions because they are genuinely reusable,
provider-agnostic conversions. `merged_with` sums two summaries field by
field, treating `None` as "no data" rather than zero so a field that was
never reported doesn't get clobbered to `0`.

It lives in `app/schemas` because `app/providers` reads it too, and
`app.chat` depends on `app.providers` rather than the reverse.

This model intentionally does NOT replace the raw provider usage payload
(`RunState.latest_usage_payload` / `StreamOutcome.usage` / `ParsedChatResponse.usage`).
That payload can carry provider-specific extra keys (e.g. OpenRouter's
`cost_details`, `completion_tokens_details`) that flow through to the API
response unmodified today (see `frontend/src/lib/types/chat.ts`'s
`UsageBreakdown`, which has an index signature precisely for this). Those are
not "a dict with a stable key set" in the sense the data-oriented design rule
means — they're an open-ended, provider-defined bag — so they stay
`dict[str, Any]` pass-through. `UsageSummary` models only the fixed,
known-shape aggregate derived *from* that payload.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from app.schemas.enums import UsageUnit


def coerce_usage_value(value: object) -> int | None:
    """Coerce usage values into integer token counts when possible."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return None
    if isinstance(value, dict):
        total = 0
        has_component = False
        for nested in value.values():
            coerced = coerce_usage_value(nested)
            if coerced is not None:
                total += coerced
                has_component = True
        return total if has_component else None
    return None


def coerce_float_value(value: object) -> float | None:
    """Coerce numeric-like values into floats when possible."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def extract_reasoning_tokens_from_usage(usage: dict[str, Any]) -> int | None:
    """Extract reasoning token counts from a usage payload."""
    if not usage:
        return None
    direct = coerce_usage_value(usage.get("reasoning_tokens"))
    if direct is not None:
        return direct
    details = usage.get("completion_tokens_details")
    if isinstance(details, dict):
        nested = coerce_usage_value(details.get("reasoning_tokens"))
        if nested is not None:
            return nested
    return None


class UsageSummary(BaseModel):
    """Typed aggregate of the known OpenRouter usage fields.

    All fields are optional: `None` means "not reported", distinct from `0`
    tokens actually used. `from_raw` extracts this shape from a raw provider
    usage payload; `merged_with` accumulates two summaries (e.g. across the
    several provider calls a single tool-calling turn can make).
    """

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    reasoning_tokens: int | None = None
    cost: float | None = None

    @classmethod
    def from_raw(cls, usage: dict[str, Any] | None) -> UsageSummary:
        """Build a summary from a raw provider usage payload."""
        if not usage:
            return cls()
        return cls(
            prompt_tokens=coerce_usage_value(usage.get("prompt_tokens")),
            completion_tokens=coerce_usage_value(usage.get("completion_tokens")),
            total_tokens=coerce_usage_value(usage.get("total_tokens")),
            reasoning_tokens=extract_reasoning_tokens_from_usage(usage),
            cost=coerce_float_value(usage.get("cost")),
        )

    def merged_with(self, other: UsageSummary) -> UsageSummary:
        """Return a new summary with each field summed, `None`-safe."""

        def _add(left: float | None, right: float | None) -> float | None:
            if left is None:
                return right
            if right is None:
                return left
            return left + right

        return UsageSummary(
            prompt_tokens=_add(self.prompt_tokens, other.prompt_tokens),
            completion_tokens=_add(self.completion_tokens, other.completion_tokens),
            total_tokens=_add(self.total_tokens, other.total_tokens),
            reasoning_tokens=_add(self.reasoning_tokens, other.reasoning_tokens),
            cost=_add(self.cost, other.cost),
        )

    def is_empty(self) -> bool:
        """Return True when no field has been populated."""
        return not self.model_dump(exclude_none=True)


@dataclass(frozen=True)
class MeasuredUsage:
    """One provider call's reported spend, as the ledger stores it.

    `quantity` is always a number the provider actually stated. A response
    reporting nothing produces no `MeasuredUsage` at all, so the ledger never
    carries a zero standing in for "unknown".
    """

    quantity: int
    unit: UsageUnit
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    reported_cost: float | None = None


def token_usage(
    *,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None = None,
    reported_cost: float | None = None,
) -> MeasuredUsage | None:
    """Build a token-denominated measurement, or None when nothing was reported.

    A provider that states only a total is believed for the total; one that
    states only the sides is totalled from them.
    """
    total = total_tokens
    if total is None and (prompt_tokens is not None or completion_tokens is not None):
        total = (prompt_tokens or 0) + (completion_tokens or 0)
    if total is None:
        return None
    return MeasuredUsage(
        quantity=total,
        unit=UsageUnit.TOKENS,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        reported_cost=reported_cost,
    )


def usage_from_counters(counters: dict[str, int] | None) -> MeasuredUsage | None:
    """Read an embedder's reported counters into a measurement.

    Embedders report the OpenAI-compatible counter names; a payload carrying
    none of them measures nothing.
    """
    if not counters:
        return None
    return token_usage(
        prompt_tokens=counters.get("prompt_tokens") or counters.get("input_tokens"),
        completion_tokens=counters.get("completion_tokens") or counters.get("output_tokens"),
        total_tokens=counters.get("total_tokens"),
    )


def usage_from_summary(summary: UsageSummary) -> MeasuredUsage | None:
    """Read a parsed chat usage summary into a measurement."""
    return token_usage(
        prompt_tokens=summary.prompt_tokens,
        completion_tokens=summary.completion_tokens,
        total_tokens=summary.total_tokens,
        reported_cost=summary.cost,
    )


def search_unit_usage(units: int | None) -> MeasuredUsage | None:
    """Build a search-unit measurement for a provider that bills in them.

    Cohere prices reranking per search unit and publishes no token count for
    it, so the quantity is recorded in the unit the provider actually stated
    rather than converted into a token number nobody published.
    """
    if units is None:
        return None
    return MeasuredUsage(quantity=units, unit=UsageUnit.SEARCH_UNITS)
