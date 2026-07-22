# Sandbox Engineering Practices

Rules for working in `sandbox/` (the seeded-scenario harness) and
`frontend/e2e/` (the saved browser flows it runs). Repo-wide rules apply here
too. User-facing usage lives in `docs/sandbox.md`; this file holds the
invariants that keep the harness trustworthy.

## What this is

`uv run python -m sandbox up <scenario>` puts a fully isolated copy of the
app (own DB `ragworks_sandbox`, own `.sandbox/` storage/config, ports
8010/3010) into a named state and prints a handoff (login, JWT, deep links,
browser-login snippet). `sandbox flows` reruns committed Playwright specs
against those states. The point is token economy: setup an agent doesn't pay
for, and validated flows that rerun for free.

## Invariants

- **Apply the sandbox environment before any `app.*` import.**
  `app/db/engine.py` binds `DATABASE_URL` at import time, so every module in
  this package imports app code *inside functions*, and `cli.main` calls
  `apply_backend_env()` first. A module-level `from app… import …` here is
  the bug this rule exists for.
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
- **Builders record everything they create on the `SeedContext`**: typed
  attributes for later builders, one `facts` line per object, and a `links`
  entry for every object with a page — the handoff's deep links are how a
  browser session skips navigation.
- **The harness owns the server lifecycle.** Detached process groups,
  pidfiles and logs under `.sandbox/`; `_reseed` restarts only the backend
  (the frontend is stateless across scenarios). Never run
  `npx playwright test` bare — specs need the seeded DB and handoff that
  `sandbox flows` provides.
- **Flows run against a production frontend build** (`next build` +
  `next start`, mode tracked in `.sandbox/frontend.mode`). Dev-mode
  HMR/on-demand compilation emits full-page reloads under Playwright that
  wipe in-flight client state — a login redirect bounced back to the sign-in
  page for 30s straight until flows moved off `next dev`. `up` keeps dev
  mode for interactive testing; don't point flows at it.

## Adding a scenario

1. Compose existing builders in a new `sandbox/scenarios/<name>.py`; call
   another scenario's `seed` first to build on it (see `evals_ready.py`).
2. A new builder is justified only for a new object type; it follows the
   service-layer rule and records facts + links.
3. Register with `@scenario(name, description, requires, state)` — `requires`
   names must exist in `keys.PROVIDER_ENV_VARS`.
4. Regenerate the catalog (`python -m sandbox docs`) and commit it with the
   scenario; verify live with `sandbox up <name>` that the app shows exactly
   what `state` claims.

## Adding a flow (`frontend/e2e/`)

1. Specs live at `frontend/e2e/<scenario>/<flow>.spec.ts` — the directory
   name is the scenario the spec needs; `sandbox flows` discovers it from
   the path. Start from the nearest existing spec; keep the numbered intent
   steps in the top comment block.
2. Use the shared helpers, never hand-rolled equivalents: `loadHandoff()`
   for seeded ids/URLs (hardcoding an id breaks on every reseed),
   `seededLink()`, `loginViaApi(page)` (auth-flow specs use the form via
   `gotoSignIn(page)`, which waits out hydration — clicking earlier silently
   does nothing).
3. Assert deterministic outcomes; LLM-produced values (counts, wording) are
   asserted by shape (`/\d+ queries/`), never exact value — an exact-count
   assertion on grader-accepted questions was the first flake.
4. Flow specs are typed and linted by the frontend gate (`npm run verify`)
   but excluded from vitest; run them only via `sandbox flows <scenario>`.
5. When manual testing validates a new flow, harden it into a spec in the
   same PR — flows exist so the next agent reruns instead of re-derives.

## Testing the harness itself

Pure parts (registry, catalog rendering, key preflight with stubbed
validation) are unit-tested in `tests/sandbox/`. Server lifecycle code is
tooling verified by live use — don't unit-test process wrangling. The
package is in the mypy strict + ruff gate (`make verify`); pylint stays
scoped to `app/`.
