# Ragworks

Ragworks is a FastAPI backend (`app/`) with a Next.js frontend (`frontend/`) — an
easy-to-use RAG interface for power users. Its backbones are pluggable vector stores
(pgvector in the shipped Postgres by default, Pinecone optionally) and pluggable
model providers behind per-user connections (OpenRouter and Ollama today, embeddings
+ chat), mixable per pipeline and per chat session.

This file holds only repo-wide rules. Area rules live next to the code they govern —
load the one for the code you're touching; area files extend these rules, they never
replace them:

- Backend (`app/`): @app/AGENTS.md
- Frontend (`frontend/`): @frontend/AGENTS.md

# Verify gates

Nothing ships without its gate passing. Run the gate for every area you changed:

- Backend: `make verify` (typecheck → lint → test), plus `make coverage` (review
  `term-missing`)
- Frontend: `npm run verify` in `frontend/` (typecheck → lint → tests), plus
  `make format-check-frontend`

If you only changed one side, only that side's gate is required. CI (`ci.yml`) runs
both gates (plus a frontend `npm run build`) on every PR and push to `main`.

# Bug fixes require a regression test

Whenever a bug is fixed, a regression test must be written alongside the fix, **in the
same commit** — verified red-green: run the test without the fix and watch it fail for
the bug's reason, then apply the fix and watch it pass. This is how the test suite
grows: on things we know were broken, not on coverage padding. A bug fix PR with no
failing-then-passing test is incomplete.

# Commits

- Subjects are conventional-commit style with a scope: `type(scope): summary`, e.g.
  `feat(pipelines): …`, `fix(ui): …`, `test(chat): …`, `docs: …`. Types: `feat`,
  `fix`, `test`, `docs`, `refactor`, `chore`, `ci`. The scope names the feature area
  or subsystem that changed, lowercase; omit it only when nothing narrower than the
  whole repo fits (`docs: …`).
- Never use the `!` breaking marker (`feat!:`) — breaking changes are flagged with
  the `breaking` PR label, which is what release notes are built from.
- Imperative mood, no trailing period, ≤72 characters. Add a body when the *why*
  isn't obvious from the subject.
- Commit as you go on a branch: small, coherent commits per logical step — never one
  squashed mega-commit at the end of the work.
- A bug fix and its regression test share one commit (see above).

# Pull requests

- Work on a branch; merge to `main` via PR. Keep PRs to one concern.
- The PR title follows the commit-subject convention. The description states what
  changed, why, and how it was verified (name the gates you ran), and links the
  issue (`Refs #N` / `Closes #N`).
- If a change spans the API contract (backend schemas + frontend types), update both
  sides in the same PR so they can't drift — and say so in the description. Same for
  the `docker-compose.yml` ↔ README mirror (below).
- Every PR carries at least one release-notes label (`breaking`, `feature`, `fix`,
  `docs`, `ci`, `dependencies`, `chore`, or `skip-changelog`) — the `PR labels` check
  fails without one, and `.github/release.yml` uses them to organize release notes.

# Releases

Docker is the release vehicle, and releases go through a **release PR** — never a
push straight to `main`, and never a hand-created tag. `make
bump-patch|bump-minor|bump-major` (pre-releases: `make bump-rc`, SemVer `-rc.N`), or
the **Open release PR** workflow-dispatch button, runs `scripts/bump_version.py`: it
bumps the version on a `release/v<version>` branch and opens a PR — it does **not**
push to `main` or create the tag. Merging that PR fires `release.yml`, which tags the
merge commit, publishes multi-arch `ghcr.io/neeeser/ragworks-backend` / `-frontend`
images (`X.Y.Z` + `X.Y` + `latest` for stable, `X.Y.Z-rc.N` alone for pre-releases),
and cuts the GitHub Release with label-organized notes. The version lives in
`pyproject.toml` and `frontend/package.json` (plus lockfiles); only
`scripts/bump_version.py` writes it. Every push to `main` publishes rolling `edge`
images (`edge.yml`) for testing — never a release. The multi-arch build is one
reusable workflow (`build-images.yml`) shared by `release.yml` and `edge.yml`.

The shipped `docker-compose.yml` is deliberately minimal and self-contained: no
`.env` file, no required edits, `latest` image tags, hardcoded network-internal
Postgres password, host port `7247`. The JWT signing secret is auto-generated on
first boot and persisted in the `backend-config` volume — separate from the bulk
`document-storage` volume so reclaiming space never rotates it; setting
`JWT_SECRET_KEY` overrides it. **The README quick-start Compose block is a
byte-for-byte mirror of `docker-compose.yml` — any change to either updates both in
the same PR.** The frontend image is built without `NEXT_PUBLIC_API_BASE_URL` and
proxies same-origin `/api/*` calls via the runtime `API_PROXY_TARGET` middleware
(`frontend/src/middleware.ts`) — a build-time `rewrites()` in `next.config.ts` can't
see an env var set when the container starts.

# Two runtime modes — every change works in both

The app runs two ways, and a change isn't done until it works in both:

- **Dev mode**: `make run` (or `make server` + `make frontend` separately) —
  uvicorn with reload, the Next.js dev server, `NEXT_PUBLIC_API_BASE_URL` pointing
  the frontend straight at the backend, `DEBUG=true`.
- **Docker**: `docker-compose.yml` — the primary target, because Docker is the
  release format. Same-origin `/api/*` through the runtime middleware proxy, no
  build-time API URL, `DEBUG=false`, secrets/volumes as described under Releases.

The modes differ in exactly the ways that hide bugs: how the frontend reaches the
API (direct URL vs runtime proxy), env-var timing (dev reads them live; a Docker
image bakes build-time values), debug defaults, and storage paths. When a change
touches startup, config, routing, storage, or anything env-dependent, verify it in
(or reason it through for) both modes — "works with `make run`" alone is not done.

# Configuration architecture

The project is heading toward being fully config-driven (runtime-editable settings,
feature flags, defaults). The layering is settled — build toward it, don't drift:

- **Layer 1 — bootstrap/infrastructure: environment variables.** Only what the
  process needs before it can serve, or what binds it to infrastructure:
  `DATABASE_URL`, `FILE_STORAGE_PATH`, `CONFIG_PATH`, `DEBUG`, `JWT_SECRET_KEY`
  (optional override), ports. Not runtime-editable. Never grow this layer with
  application-behavior settings.
- **Layer 2 — runtime application config: Postgres (`app_settings` table).**
  `AppConfig` (`app/schemas/app_config.py`) is the single source of truth for code
  defaults and the field catalog the admin UI renders from. The sparse
  `app_settings` table stores overrides only; `AppConfigService.effective_config()`
  merges env-pinned → DB override → code default. `GET /api/config` serves the
  public subset unauthenticated; `GET/PATCH /api/admin/config` (admin-gated)
  serve/edit the full catalog. Never introduce file-based runtime config (a
  config.yaml in a volume) — the DB is the config store. **There are no global
  default models** — shipped model ids rot as providers deprecate them (a hardcoded
  default once 502'd every first upload). Model choices are always explicit
  `(provider connection, model)` pairs; default-pipeline scaffolding raises a clear
  `InvalidInputError` when no defaults exist yet.
- **Layer 3 — per-user settings** (provider connections, session preferences) —
  stays per-user, never migrates into global config. Provider credentials live on
  the `provider_connections` table (one row per configured provider instance),
  never as columns on `User`.
- **The frontend is an API client, never a config owner.** Frontend-related settings
  are fields in the central config fetched over the API. The frontend container
  mounts no volumes and reads no config files; sharing a volume between frontend and
  backend is an anti-pattern (two writers, no validation, secret exposure).
- **The `backend-config` volume (`CONFIG_PATH`) is *not* the central config store**:
  it holds only machine-generated state that must exist before the DB is reachable
  (today: the auto-generated JWT secret). One volume, one writer.

# Cross-cutting constraints

- **External API changes (Pinecone, OpenRouter):** read the locally downloaded docs
  in `docs/external-api/{pinecone,openrouter}/` first — they reflect the versions we
  actually run against; trust them over memory. They're gitignored, so in a fresh
  worktree fetch them first: `node scripts/download-openrouter-docs.mjs` /
  `node scripts/download-pinecone-docs.mjs`.
- **The wire contract is defined once, in `app/schemas/`.** Frontend types in
  `frontend/src/lib/types/` hand-mirror them; when a schema changes, the mirror
  changes in the same PR.
- **Chat parameter keys are matched exact-case** (`app/schemas/chat_parameters.py`):
  `ChatParameters` ignores unknown keys and `ProviderPreferences` normalizes only a
  small alias set — a deliberate narrowing from an old case-insensitive sanitizer.
  Send canonical snake_case keys.

# README style and maintenance

- Write for self-hosters first, in concise factual language. Keep the project
  identity provider-neutral; name supported providers only where setup requires it.
- Restrained visuals: one short tagline, a curated row of stable badges, sparing
  emoji. No badge walls, inflated claims, volatile metrics, or roadmap checklists.
  Link to canonical docs instead of duplicating details that change frequently.
- Keep the README Compose block byte-for-byte identical to `docker-compose.yml`;
  keep the YAML free of comments and put operational context in surrounding prose.
- Run `make readme-assets` whenever default pipeline definitions or their rendered
  components change (requires Playwright Chromium, `ffmpeg`, `gifski`); commit the
  regenerated light/dark animations and posters, keep each GIF ≥1440px wide and
  under its 8 MB guard, and inspect first/last frames of each scene in both themes.
  Verify README links, commands, and factual claims with every update.

# Make commands

- `make env`: install backend deps via `uv` and frontend deps via `npm`
- `make server` / `make frontend` / `make run`: run backend, frontend, or both (dev)
- `make verify`: the backend gate — typecheck → lint → test
- `make test` / `make test-frontend`: backend (pytest) / frontend (vitest) tests
- `make coverage` / `make coverage-frontend`: coverage runs (fail on test failure);
  `-report` variants are non-blocking, `-open` variants open the HTML report
- `make typecheck`: `mypy app` (strict); `make lint`: ruff + pylint on `app/`
- `make lint-frontend` / `make format-frontend` / `make format-check-frontend`:
  ESLint / Prettier write / Prettier check on `frontend/`
- `make readme-assets`: regenerate the README pipeline animations and posters
- `make bump-patch|bump-minor|bump-major|bump-rc`: open a release PR (see Releases —
  these never push to `main` or create tags themselves)

# Maintaining these AGENTS.md files

These files are lessons learned about writing good, consistent code in this repo.
The structure is fixed at three files — this root file for repo-wide design, infra,
CI, and release rules; `app/AGENTS.md` and `frontend/AGENTS.md` for their areas. No
nested AGENTS.md files deeper in the tree.

**Adding a rule.** When a fix, incident, or review teaches a durable rule, add it to
the relevant AGENTS.md **in the same PR** — never batched later. A rule earns its
place by capturing a non-obvious repo invariant or a proven failure mode; write it
as a concise imperative plus one line of *why* (the failure it prevents). That
one-line why is load-bearing, not decoration — a bare imperative is easy to
rationalize around; "nothing was written and the test still passed" is not. Put the
rule in the narrowest file where it always applies, and state it once — a child file
extends the root, it never restates or contradicts it.

**What doesn't belong.** Generic language/framework advice, transient feature
status, tutorials, and facts easily discovered from the code. Known gaps and tech
debt become GitHub issues, not AGENTS.md sections — a "tracked" claim with no issue
behind it is how stale text accumulates.

**Editing or condensing these files is high-risk** — deleting the wrong sentence
silently weakens every future change. Treat it as a behavior-preserving refactor:
classify each block (keep / condense / correct / remove) before touching it, keep
every rule plus its one-line why, and never move a rule somewhere with a weaker
loading trigger than the file it's in. While editing, verify that every referenced
path still exists and that the files don't contradict each other or the
Makefile/workflows — stale prose loses to mechanical sources, and this file has
shipped contradictions before (a bump-command summary that disagreed with the
release process it sat next to). Prune rules when the architecture or enforcement
that motivated them changes.
