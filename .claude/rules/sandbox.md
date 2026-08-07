---
paths:
  - "sandbox/**"
  - "frontend/flows/**"
---

# Sandbox Engineering Practices

Rules for working in `sandbox/` (the seeded-scenario harness) and
`frontend/flows/` (the saved browser flows it runs). Repo-wide rules apply here
too. User-facing usage lives in `docs/sandbox.md`; this file holds the harness
invariants.

## What this is

`uv run python -m sandbox up <scenario>` puts a fully isolated copy of the
app (own DB `ragworks_sandbox`, own `.sandbox/` storage/config, ports
8010/3010; a linked git worktree derives its own database name and port
offset from the worktree path so concurrent agents don't collide — always
read URLs from the printed handoff, never assume the defaults) into a named
state and prints a handoff (login, JWT, deep links, browser-login snippet). `sandbox flows` reruns committed Playwright specs
against those states. Setup an agent doesn't pay for; validated flows rerun for
free.

## Invariants

- **Apply the sandbox environment before any `app.*` import.**
  `app/db/engine.py` binds `DATABASE_URL` at import time, so every module in
  this package imports app code *inside functions*, and `cli.main` calls
  `apply_backend_env()` first. Never write a module-level `from app… import …`
  in this package.
- **Seeding goes through the app's own service layer, never raw SQL or
  HTTP.** Builders call `AccountService`, `ConnectionService`,
  `SetupService.bootstrap`, `run_document_ingestion`, … so seeded state is
  by construction what the running app would have created. If seeding a new
  object needs a query, the service layer is missing something — fix it
  there.
- **The scenario catalog is generated, never edited.**
  `docs/sandbox-scenarios.md` renders from `@scenario` metadata
  (`python -m sandbox docs`); `tests/sandbox/test_catalog.py` fails the gate
  on drift. A scenario's `state` bullets are what agents read instead of
  exploring — keep them exactly true.
- **Keys are validated before any state is touched.** `keys.preflight` runs
  the app's own `validate_connection` per required provider; a broken key
  fails by env-var name, never as a half-seeded state. Keys load only from
  `.env.sandbox` / the environment — never committed, never read by the app.
- **A pipeline's deep link is `/pipelines/{kind}?pipeline={id}`.** A bare
  `/pipelines/{id}` is an unknown kind: the route redirects and the editor
  opens on whatever pipeline it defaults to, so a link written that way sends
  every browser session to the wrong graph.
- **Builders record everything they create on the `SeedContext`**: typed
  attributes for later builders, one `facts` line per object, and a `links`
  entry for every object with a page — the handoff's deep links are how a
  browser session skips navigation.
- **The harness owns the server lifecycle.** Detached process groups,
  pidfiles and logs under `.sandbox/`; `_reseed` restarts only the backend
  (the frontend is stateless across scenarios). Never run
  `npx playwright test` bare — specs need the seeded DB and handoff that
  `sandbox flows` provides.
- **The flows runner hands `SANDBOX_FRONTEND_URL` to Playwright.** The
  playwright config's `baseURL` falls back to the default port, and a
  worktree's sandbox runs on offset ports — without the env hand-through,
  every relative `page.goto` in a worktree hits a server that isn't there
  and the whole suite fails only where concurrent agents run it.
- **Flows run against a production frontend build** (`next build` +
  `next start`, mode tracked in `.sandbox/frontend.mode`). Dev-mode
  HMR/on-demand compilation emits full-page reloads under Playwright that
  wipe in-flight client state — a login redirect can bounce back to the
  sign-in page indefinitely. `up` keeps dev
  mode for interactive testing; don't point flows at it.
- **`up`'s dev-mode pages carry Next's own dev-tools indicator in the
  bottom-left corner** — a dark circle with the Next mark, overlapping the
  console rail's footer. It is not application chrome; don't "fix" it after
  reading a screenshot, and don't assert around that corner.

## Testing a UI feature — the workflow

Cheapest step first; skipping ahead repeats setup the harness already did:

1. **Check the catalog** (`docs/sandbox-scenarios.md`) for the closest seeded
   state; check `sandbox flows --list` for a saved flow that already exercises
   the surface. Rerun or extend an existing flow before deriving clicks by
   hand.
2. **`sandbox up <scenario>`**, then go straight in: evaluate the handoff's
   `browser_login` snippet instead of the sign-in form, navigate via the
   `open:` deep links instead of the nav, and assert non-visual facts through
   the API with the handoff JWT instead of page snapshots. Snapshots are for
   the UI behavior actually under test.
3. **Missing state?** Add a scenario (below) rather than hand-building it in
   the browser. **Validated a new flow manually?** Harden it into a spec
   (below) in the same PR as the feature — that is how the catalog and flow
   suite stay useful for the next agent.
4. **Real keys are the point.** A provider-specific feature is only tested
   when it ran against a real key from `.env.sandbox`. If the key is missing
   and you fall back to a mock or placeholder, say so to the user *before*
   reporting results — "passed with a fake key" is not evidence the provider
   integration works.

## Verification blind spots — name the layer's limit before trusting it

- jsdom computes no layout: every element measures zero, so virtualized lists
  render nothing unless their measurements are stubbed — and a test that
  fabricates the measurements it then asserts on proves nothing. Layout,
  overflow, and column-width behavior are only measurable in a real browser.
- The automated browser pane runs with `document.hidden === true`, so
  `ResizeObserver` and `requestAnimationFrame` callbacks never fire there. It
  cannot validate observer-driven behavior, and a bug seen only there may be
  an environment artifact — say which before reporting it as a defect.
- A skipped test reads exactly like a passing one: `pg_search_session` tests
  skip silently without ParadeDB. Run against the dev database and confirm
  the summary says *passed*, not *skipped*.

## Adding a scenario

1. Compose existing builders in a new `sandbox/scenarios/<name>.py`; call
   another scenario's `seed` first to build on it (see `evals_ready.py`).
2. A new builder is justified only for a new object type; it follows the
   service-layer rule and records facts + links.
3. Register with `@scenario(name, description, requires, state)` — `requires`
   names must exist in `keys.PROVIDER_SPECS`. A new provider is one
   `PROVIDER_SPECS` entry declaring its config shape (which env vars map to
   which `provider_connections.config` keys, and which are required — an
   API-key provider or a base-URL one like Ollama/TEI); seed it with the
   generic `add_provider_connection(ctx, "<provider>")` builder. Add the
   provider's vars to `.env.sandbox.example` in the **same change** — that file
   is the accurate list of what a scenario can require, and it silently drifts
   otherwise.
4. Regenerate the catalog (`python -m sandbox docs`) and commit it with the
   scenario; verify live with `sandbox up <name>` that the app shows exactly
   what `state` claims.

## Adding a flow (`frontend/flows/`)

1. Specs live at `frontend/flows/<scenario>/<flow>.spec.ts` — the directory
   name is the scenario the spec needs; `sandbox flows` discovers it from
   the path. Start from the nearest existing spec; keep the numbered intent
   steps in the top comment block.
2. Use the shared helpers, never hand-rolled equivalents: `loadHandoff()`
   for seeded ids/URLs (hardcoding an id breaks on every reseed),
   `seededLink()`, `loginViaApi(page)` (auth-flow specs use the form via
   `gotoSignIn(page)`, which waits out hydration — clicking earlier silently
   does nothing).
3. Match UI text through `filter({ hasText })`, never a `RegExp` built from a
   label string — a label carrying a regex metacharacter (`Semantic + keyword
   search`) compiles into a pattern that matches nothing, and the spec fails
   on a selector rather than the behavior it names.
4. Assert deterministic outcomes; LLM-produced values (counts, wording) are
   asserted by shape (`/\d+ queries/`), never exact value — an exact-count
   assertion on an LLM-produced number is a guaranteed flake. A model id and
   its published facts (context window, effort levels) are read from
   `GET /api/models` at run time rather than pinned in the spec: a provider
   retiring a model, or a key scoped to fewer of them, otherwise turns the
   suite red for everyone running it.
5. Flow specs are typed and linted by the frontend gate (`npm run verify`)
   but excluded from vitest; run them only via `sandbox flows <scenario>`.

## Testing the harness itself

Pure parts (registry, catalog rendering, key preflight with stubbed
validation) are unit-tested in `tests/sandbox/`. Server lifecycle code is
tooling verified by live use — don't unit-test process wrangling. The
package is in the mypy strict + ruff gate (`make verify`).
