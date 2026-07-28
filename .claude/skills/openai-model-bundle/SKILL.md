---
name: openai-model-bundle
description: Load before any work on the OpenAI provider, its model catalog, parameter panel behavior for OpenAI models, or when a user reports wrong context windows / missing knobs / unknown OpenAI models. Explains where OpenAI model capabilities come from and how to refresh the shipped bundle.
---

# OpenAI model-capability bundle

OpenAI's `GET /v1/models` publishes no capabilities (four fields per model), so
the app ships `app/providers/openai_model_bundle.json` — generated from
OpenAI's own per-model docs pages, which serve clean Markdown at
`https://platform.openai.com/docs/models/<id>.md`. The bundle carries context
window, max output tokens, reasoning support + effort levels, endpoint
support, modalities, deprecation status, and snapshot aliases per model.

## How it is consumed

- `app/providers/openai_bundle.py` — loader (`load_openai_bundle()`, cached
  per process) and `lookup()` (follows dated snapshot ids onto their base).
- `app/providers/openai_catalog.py` — the chat/embedding catalog refines the
  dialect parameter floor with bundle facts (hide `reasoning` on
  non-reasoning models, real context windows, effort levels, deprecated
  ordered last, never filtered).
- `app/providers/openai.py::_resolve_model` — per-turn `ModelInfo`.

**The bundle refines; it never gates.** An id the bundle has never heard of
resolves to the dialect's full parameter floor (`RESPONSES_PARAMETERS`) with
no context claim — a model OpenAI ships tomorrow must keep working from a
stale bundle. Which sampling parameters a model *accepts* is not derivable
from any source (models in the same family differ), so a rejected parameter
surfaces the provider's 400 verbatim; there is deliberately no retry/learning
layer, and `extra_body` is the user's escape hatch for unknown knobs.

## Refreshing

```bash
make refresh-openai-bundle
```

(`scripts/download-openai-model-bundle.mjs`; needs `OPENAI_API_KEY` in the
environment or `.env.sandbox`.) Then:

1. Review the diff — new families, changed context windows, new effort
   levels, models flagged `unresolved` (no docs page; recorded, not dropped).
2. Run the guard test: `uv run pytest tests/providers/test_openai_bundle.py
   tests/providers/test_openai_provider.py -n 0`. It pins the parse shape and
   known values, so a shifted docs format fails here instead of shipping a
   bundle full of nulls. If it fails, fix the *parser* in the script, not the
   pinned values (unless OpenAI genuinely changed the value — verify against
   the live docs page).
3. Commit the regenerated JSON with `chore(providers): refresh OpenAI model
   bundle`.

Refresh when: doing any OpenAI-provider work; a user reports a missing or
wrong model; OpenAI ships a new family. Staleness degrades gracefully (floor
+ conservative context), so there is no scheduled automation.
