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
from functools import cache
from pathlib import Path
from re import sub

from pydantic import BaseModel

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

    def effort_options(self) -> list[str]:
        """Effort levels for a reasoning model; empty for a non-reasoning one."""
        if not self.reasoning:
            return []
        return self.reasoning_efforts or list(DEFAULT_REASONING_EFFORTS)


class OpenAIModelBundle(BaseModel):
    """The shipped bundle: models by base id, plus ids the docs never covered."""

    source: str
    generated_at: str
    models: dict[str, BundleModel]
    unresolved: list[str]

    def lookup(self, model_id: str) -> BundleModel | None:
        """Resolve an id, following dated snapshots onto their base entry."""
        entry = self.models.get(model_id)
        if entry is not None:
            return entry
        base_id = sub(r"-\d{4}-\d{2}-\d{2}$", "", model_id)
        return self.models.get(base_id)


@cache
def load_openai_bundle() -> OpenAIModelBundle:
    """Load the shipped bundle once per process (the file is static)."""
    raw = json.loads(_BUNDLE_PATH.read_text())
    return OpenAIModelBundle.model_validate(raw)
