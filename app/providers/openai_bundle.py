"""Shipped OpenAI model-capability bundle.

`GET /v1/models` publishes no capabilities, so the app ships a bundle parsed
from OpenAI's own per-model docs pages (`platform.openai.com/docs/models/
<id>.md`) — context window, max output tokens, reasoning support, endpoints,
deprecation. Regenerate with `make refresh-openai-bundle`
(`scripts/download-openai-model-bundle.mjs`); the guard test in
`tests/providers/test_openai_bundle.py` pins the shape and known values so a
regeneration under a shifted docs format fails loudly.

An id absent from the bundle is not an error: the account may list models the
docs never covered, and a model OpenAI ships after the bundle was generated
must still work — callers fall back to the dialect's full parameter floor and
a conservative context default.
"""

from __future__ import annotations

import json
from functools import cache, cached_property
from pathlib import Path
from re import sub

from pydantic import BaseModel

from app.schemas.models import ChatCapabilities, ReasoningStyle, SamplingSupport

_BUNDLE_PATH = Path(__file__).parent / "openai_model_bundle.json"

#: Efforts assumed for a reasoning model whose docs page states no list.
DEFAULT_REASONING_EFFORTS: tuple[str, ...] = ("low", "medium", "high")


class BundleEndpoints(BaseModel):
    """Which API surfaces the model serves."""

    chat_completions: bool
    responses: bool
    embeddings: bool


class BundleModel(BaseModel):
    """One model's capabilities as published on its docs page."""

    display_name: str | None
    context_window: int | None
    max_output_tokens: int | None
    input_modalities: list[str]
    output_modalities: list[str]
    knowledge_cutoff: str | None
    reasoning: bool
    reasoning_efforts: list[str] | None
    endpoints: BundleEndpoints
    function_calling: bool
    structured_outputs: bool
    streaming: bool
    deprecated: bool
    snapshots: list[str]
    #: Measured at generation time; None where the probe was skipped (a
    #: premium-priced model) or could not answer.
    sampling: SamplingSupport | None = None
    #: Whether the model accepts `reasoning.effort: none`, measured rather
    #: than read: several models accept it without their docs page saying so,
    #: and it is the level that keeps their sampling knobs usable.
    supports_effort_none: bool | None = None

    def effort_options(self) -> list[str]:
        """Effort levels for a reasoning model; empty for a non-reasoning one.

        Composed from the two sources rather than one overwriting the other:
        the docs page names the levels it documents, and the probe answers
        `none` — which several models accept without documenting it.
        """
        if not self.reasoning:
            return []
        levels = list(self.reasoning_efforts or DEFAULT_REASONING_EFFORTS)
        if self.supports_effort_none and "none" not in levels:
            levels.insert(0, "none")
        return levels

    def capabilities(self) -> ChatCapabilities:
        """State this model's capabilities from what the docs page published.

        The single place the bundle is turned into capability claims — the
        catalog listing and the per-turn resolver both read it, so a new
        capability cannot land in one and be forgotten in the other.
        """
        return ChatCapabilities(
            tools=self.function_calling,
            reasoning=ReasoningStyle.BLOCK if self.reasoning else ReasoningStyle.NONE,
            reasoning_efforts=self.effort_options(),
            # Unmeasured stays permissive, like the knob floor.
            sampling=self.sampling or SamplingSupport.ALWAYS,
        )


class OpenAIModelBundle(BaseModel):
    """The shipped bundle: models by base id, plus ids the docs never covered."""

    source: str
    generated_at: str
    models: dict[str, BundleModel]
    unresolved: list[str]

    @cached_property
    def _by_snapshot(self) -> dict[str, BundleModel]:
        """Index every snapshot id each entry names onto that entry.

        Snapshot ids do not all share one spelling — `gpt-4.1-2025-04-14` is
        dated, `gpt-4-0613` and `gpt-3.5-turbo-0125` are not — so stripping a
        date pattern reaches only some of them. The entries list their own,
        which is the authoritative answer.
        """
        return {
            snapshot: entry
            for entry in self.models.values()
            for snapshot in entry.snapshots
        }

    def lookup(self, model_id: str) -> BundleModel | None:
        """Resolve an id, following snapshots and fine-tunes to their base."""
        entry = self.models.get(model_id)
        if entry is not None:
            return entry
        # `ft:<base>:<org>::<id>` — a fine-tune inherits its base's capabilities.
        if model_id.startswith("ft:"):
            model_id = model_id.split(":")[1] if ":" in model_id[3:] else model_id[3:]
            entry = self.models.get(model_id)
            if entry is not None:
                return entry
        snapshot_entry = self._by_snapshot.get(model_id)
        if snapshot_entry is not None:
            return snapshot_entry
        return self.models.get(sub(r"-\d{4}-\d{2}-\d{2}$", "", model_id))


@cache
def load_openai_bundle() -> OpenAIModelBundle:
    """Load the shipped bundle once per process (the file is static)."""
    raw = json.loads(_BUNDLE_PATH.read_text())
    return OpenAIModelBundle.model_validate(raw)
