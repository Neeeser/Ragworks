# OpenAI capability bundle + parameter floor — design

Approved 2026-07-28. Refactor branch context: `api_dialect` exists only on this
branch (never released), so removing it is a field deletion with no migration.

## Problem

OpenAI's `/v1/models` publishes no capabilities (4 fields per model), unlike
OpenRouter's rich catalog. The current OpenAI provider therefore ships a blank
parameter panel, a dishonest 8192-token context fallback that silently trims
1M-context models, and raw 502s when a model rejects a parameter. Live probing
established that per-model sampling-parameter acceptance is not derivable from
any source (gpt-5.6-luna accepts `temperature`, gpt-5.6-terra rejects it), but
OpenAI's docs pages (`platform.openai.com/docs/models/<id>.md`) serve clean
per-model Markdown with context window, max output, reasoning, tools,
endpoints, modalities, and deprecation — first-party and deterministic.

## Decisions (user-approved)

- **No third-party model databases** (LiteLLM, models.dev). First-party docs only.
- **No rejection-learning/retry layer.** A parameter the model rejects surfaces
  the provider's 400 verbatim in the chat UI; the message names the exact field.
- **No CI for the first pass.** Refresh is a local script + make target + skill.
  (A scheduled diff-gated PR workflow may come later; it needs an
  `OPENAI_API_KEY` repo secret the user does not want to add yet.)
- **OpenAI provider is Responses-only.** `api_dialect` deleted; retired
  `*-chat-latest` ids excluded from the chat catalog.
- **Parameter panel is never blank.** Dialect floor everywhere, bundle refines.
- **Custom body pass-through** (`extra_body`) in API + frontend.

## 1. Bundle generation

`scripts/download-openai-model-bundle.mjs`, following the
`download-openrouter-docs.mjs` pattern. Lists `/v1/models` (key from env),
fetches `platform.openai.com/docs/models/<id>.md` per chat/embedding id, parses:
context window, max output tokens, reasoning + effort levels, tool calling,
structured output, modalities, supported endpoints, deprecation status. Output:
`app/providers/openai/model_bundle.json`, checked in (shipped data, unlike the
gitignored docs mirrors). A docs page that 404s produces a minimal entry flagged
`unresolved` so gaps are recorded, not silently omitted.

Guard test pins the JSON schema plus known values (gpt-4.1 context = 1_047_576,
o4-mini reasoning = true) so a regeneration under a shifted docs format fails
the gate loudly.

Refresh: `make refresh-openai-bundle` + a skill documenting when to run it
(any OpenAI-provider work) and how to verify the diff (guard test + spot-check
against the live docs page).

## 2. Resolver reads the bundle

The OpenAI model resolver returns real `ModelInfo`: context window / max output
from the bundle; known reasoning models get effort options from the bundle.
Unknown id → dialect floor parameter set + conservative context default, never
a silent 8K trim and never a blank panel. Deprecated/retired models order last,
never filtered (order-don't-filter rule). `gpt-5-chat-latest` /
`gpt-5.1-chat-latest` are retired (404 on both surfaces) and excluded.

## 3. Parameter floor

Each dialect declares its full parameter set; the panel always renders it. The
bundle refines only what it is provably right about: hide reasoning knobs on
non-reasoning models, supply real effort options. Custom servers (vLLM,
llama.cpp, LM Studio) get the full Chat Completions floor with standard
defaults.

## 4. Rejections surface verbatim

No retry, no cache. Verify the `unsupported_parameter` 400 message reaches the
chat UI intact (today some surface as bare 502s); regression test pins it.
`response.failed` on the Responses stream is wired into the error path instead
of returning an empty answer (`response_error_text` used or deleted).

## 5. Mechanical items

- Delete `api_dialect` (field, adapter branch, frontend form usage).
- `stream_options: {include_usage: true}` on the Chat Completions dialect
  (verified live: without it, zero usage chunks; OpenRouter unaffected — it
  uses `usage: {include: true}`).
- `max_tokens` canonical in `RESPONSES_PARAMETERS` so the existing
  `_PARAMETER_ALIASES` rename to `max_output_tokens` actually fires.

## 6. Custom body pass-through

- **API:** `extra_body: dict[str, JsonValue]` on `ChatParameters`. Bypasses
  `sanitize_parameter_overrides` by design ("you asked for it, we send it").
  Merged into the provider request body last — user's key wins. Each provider
  maps it through its existing wire path (Responses body, Chat Completions
  body, OpenRouter `extra_body`, Ollama `options`).
- **Frontend:** "Additional parameters" section at the bottom of the parameter
  panel — key + JSON-value rows, valid-JSON check only, persisted with session
  chat parameters. Server rejections surface verbatim per §4.
- Not a way to override URL/auth/model; not probed or learned from.

## Testing

Guard test on the bundle; resolver tests (known id, unknown id, deprecated
ordering); dialect tests for `stream_options` and the `max_tokens` rename;
error-path regression for `unsupported_parameter`; `extra_body` merge tests
(backend) + panel tests (frontend); full gates both sides; live sandbox +
browser verification against real keys before done.
