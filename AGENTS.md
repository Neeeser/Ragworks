# Ragworks

Ragworks is a FastAPI backend (`app/`) with a Next.js frontend (`frontend/`).
The goal is an easy-to-use RAG interface for power users. Its backbones are Pinecone
for vector storage and OpenRouter for embeddings and LLMs.

This file holds only repo-wide rules. Area-specific engineering practices live next to
the code they govern — load the one for the code you're touching:

- Backend (`app/`): @app/AGENTS.md
- Frontend (`frontend/`): @frontend/AGENTS.md

# Verify gates

Nothing ships without its gate passing. Run the gate for every area you changed:

- Backend: `make verify` (typecheck → lint → test), plus `make coverage` (review
  `term-missing`)
- Frontend: `npm run verify` in `frontend/` (typecheck → lint → tests), plus
  `make format-check-frontend`

If you only changed one side, only that side's gate is required.

# Bug fixes require a regression test

Whenever a bug is fixed, a regression test must be written alongside the fix, **in the
same commit** — verified red-green: run the test without the fix and watch it fail for
the bug's reason, then apply the fix and watch it pass. This is how the test suite
grows: on things we know were broken, not on coverage padding. A bug fix PR with no
failing-then-passing test is incomplete.

# Commit and PR conventions

- Conventional-commit style subjects, scoped: `feat(pipelines): …`, `fix(ui): …`,
  `test(chat): …`, `docs: …`.
- Work on a branch; merge to `main` via PR. Keep PRs to one concern.
- If a change spans the API contract (backend schemas + frontend types), update both
  sides in the same PR so they can't drift.
- Every PR carries at least one release-notes label (`breaking`, `feature`, `fix`,
  `docs`, `ci`, `dependencies`, `chore`, or `skip-changelog`) — the `PR labels` check
  fails without one, and `.github/release.yml` uses them to organize release notes.

# Releases

Docker is the release vehicle: pushing a `v*` tag runs the CI gates, publishes
`ghcr.io/neeeser/ragworks-backend` / `-frontend` images (multi-arch), and cuts a
GitHub Release with `docker-compose.yml` attached. Cut a release with
`make bump-patch|bump-minor|bump-major` (pre-releases: `make bump-rc`, SemVer `-rc.N`)
followed by the printed `git push`. Pushes to `main` publish `edge` images only. The
version lives in `pyproject.toml` and `frontend/package.json`; only
`scripts/bump_version.py` writes it.

The shipped `docker-compose.yml` is deliberately minimal and self-contained: no
`.env` file, no required edits, `latest` image tags, hardcoded network-internal
Postgres password, host port `7247`. The JWT signing secret is auto-generated on
first boot and persisted in the `backend-config` volume — separate from the bulk
`document-storage` volume so reclaiming space never rotates it (`get_settings` in
`app/core/config.py`); setting `JWT_SECRET_KEY` overrides it. The exact same YAML
is pasted into README.md's quick start — **any change to `docker-compose.yml`
updates the README block (and vice versa) in the same PR; they are mirror copies.** The frontend Docker image is built without
`NEXT_PUBLIC_API_BASE_URL` and proxies same-origin `/api/*` calls to the backend via
the runtime `API_PROXY_TARGET` proxy in `frontend/src/middleware.ts` (a Next.js
`rewrites()` in `next.config.ts` is baked into the build-time routes manifest and
can't see an env var set when the container starts — middleware runs per request
instead).

# Configuration architecture

The project is heading toward being fully config-driven (runtime-editable settings,
beta/feature flags, defaults). The layering below is settled — build toward it, don't
drift from it:

- **Layer 1 — bootstrap/infrastructure: environment variables.** Only what the process
  needs before it can serve, or what binds it to infrastructure: `DATABASE_URL`,
  `FILE_STORAGE_PATH`, `CONFIG_PATH`, `DEBUG`, `JWT_SECRET_KEY` (optional override),
  ports. Not runtime-editable. Never grow this layer with application behavior
  settings.
- **Layer 2 — runtime application config: Postgres (future `app_settings` table).**
  The central, UI-editable config — defaults, feature/beta flags, upload limits,
  frontend/UI settings — is a typed `AppConfig` schema (code defaults) with the DB
  storing overrides only, served via `GET /api/config` and edited via an admin-gated
  `PATCH`. Precedence: env-pinned (locked, read-only in the UI) → DB override → code
  default. Do **not** introduce file-based runtime config (config.yaml in a volume) —
  the DB is the config store.
- **Layer 3 — per-user settings** (provider API keys, session preferences) — already
  exists; stays per-user, never migrates into global config.
- **The frontend is an API client, never a config owner.** Frontend-related settings
  are fields in the central config fetched over the API. The frontend container mounts
  no volumes and reads no config files; sharing a volume between frontend and backend
  is an anti-pattern (two writers, no validation, file-level secret exposure).
- **The `backend-config` volume (`CONFIG_PATH`) is *not* the central config store** and
  must stay narrow: machine-generated state that must exist before the DB is reachable
  (today: the auto-generated JWT secret). It is named after its single owning service
  on purpose — one volume, one writer.

# Cross-cutting constraints

- **External API changes (Pinecone, OpenRouter):** read the locally downloaded docs in
  `docs/external-api/pinecone/` and
  `docs/external-api/openrouter/` first — they reflect the versions we
  actually run against; trust them over memory. (Gitignored — fetch with
  `node scripts/download-openrouter-docs.mjs` / `node scripts/download-pinecone-docs.mjs`.)
- **The wire contract is defined once, in `app/schemas/`.** Frontend types in
  `frontend/src/lib/types/` hand-mirror them; when a schema changes, the mirror changes
  in the same PR.
- **Chat parameter keys are matched exact-case since the typed models
  (`app/schemas/chat_parameters.py`).** `ChatParameters` ignores unknown keys and
  `ProviderPreferences` only normalizes a small alias set — a deliberate narrowing from
  the old case-insensitive hand-rolled sanitizer; send canonical snake_case keys.
- **Docs are updated incrementally.** When a fix or incident teaches a rule, add it to
  the relevant AGENTS.md in that same PR — never batched later.

# Make commands

- `make env`: install backend deps via `uv` and frontend deps via `npm`
- `make server`: run FastAPI with reload (`uvicorn app.api.main:app`)
- `make frontend`: run Next.js dev server (sets `NEXT_PUBLIC_API_BASE_URL`)
- `make run`: run backend + frontend together
- `make test` / `make test-frontend`: backend (pytest) / frontend (vitest) tests
- `make coverage` / `make coverage-frontend`: coverage runs (fail on test failure)
- `make coverage-report` / `make coverage-report-frontend`: coverage, non-blocking
- `make coverage-open` / `make coverage-open-frontend`: open HTML coverage reports
- `make typecheck`: `mypy app` (strict)
- `make lint`: ruff + pylint on `app/` (and ruff on `tests/`)
- `make verify`: the backend gate — typecheck → lint → test
- `make lint-frontend` / `make format-frontend` / `make format-check-frontend`:
  ESLint / Prettier write / Prettier check on `frontend/`
- `make bump-patch` / `make bump-minor` / `make bump-major` / `make bump-rc`: bump the
  version in `pyproject.toml` + `frontend/package.json`, commit, and tag; push manually
  to publish
