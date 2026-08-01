# Ragworks

Ragworks is a FastAPI backend (`app/`) with a Next.js frontend (`frontend/`) — an
easy-to-use RAG interface for power users. Its backbones are pluggable vector stores
(pgvector in the shipped Postgres by default, Pinecone optionally) and pluggable
model providers behind per-user connections (OpenRouter, OpenAI, Anthropic,
Cohere, Ollama, Hugging Face TEI, and a custom option for any server speaking the
standard APIs), mixable per pipeline and per chat session.

This file holds only repo-wide rules. Area rules live next to the code they govern —
load the one for the code you're touching; area files extend these rules, they never
replace them:

- Backend (`app/`): @app/AGENTS.md
- Frontend (`frontend/`): @frontend/AGENTS.md
- Sandbox harness (`sandbox/` + `frontend/flows/`): @sandbox/AGENTS.md

# Writing voice — plain, factual, never pitchy

Ragworks is a serious open-source workbench for RAG developers, and every string a
user reads — UI copy, README, docs, empty states, taglines — is written like
engineering documentation, not a product pitch. State what a thing is or does in
plain sentences ("Provider connections for embeddings, chat, and vector stores"),
never sell it or narrate the UI ("Pick a collection to dive into…", "Every RAG
signal, surfaced.") — pitchy copy reads as generated filler and erodes trust in the
tool. Banned register: marketing adjectives and aphoristic taglines (seamless,
powerful, effortless, unlock, elevate, supercharge, "dive into", "at a glance",
"X, surfaced."). Explanatory text is welcome only where it tells a user something
the UI doesn't already show; if the design makes it obvious, delete the text
instead of decorating it.

# Verify gates

Nothing ships without its gate passing — but the full gate runs **once per unit of
work, not once per edit**; re-running the whole suite between micro-edits is the
slow loop this tiering exists to prevent. The loop:

- **Fast tier — per edit/commit:** backend — `uv run ruff check app tests sandbox`
  + `uv run mypy app` + the test files for the area touched (`uv run pytest
  tests/<area> -n 0`); frontend — `npm run typecheck` + targeted vitest. Commit and
  push as you go; an intermediate push may be red in CI, that's expected.
- **Full gate — once, when the work is done** (before declaring the change done /
  marking the PR ready): backend `make verify` (typecheck → lint → test with
  coverage, one suite run), reviewing `term-missing`; frontend `npm run verify`
  (typecheck → lint → tests) plus `make format-check-frontend`. Re-run only if
  more commits follow.

If you only changed one side, only that side's gate is required. CI (`ci.yml`) runs
both gates (plus a frontend `npm run build`) on every PR and push to `main`; only
the finished PR's CI run must be green — don't loop on mid-work CI failures.

**Never re-run a suite to read a different part of its output.** Piping a run
straight into `grep` discards everything else, so the next question — the failure
list after the pass count, the coverage total after the failures — costs another
full run. Redirect once to a file, then grep the file as many times as needed.

The backend suite runs parallel (pytest-xdist) against per-process databases
copied from a schema template (`tests/utils/db.py`), and database names encode the
git worktree — concurrent agents in different worktrees share the one dev Postgres
without colliding. **A run never drops a template it did not build**: a template is
keyed by schema hash, so a worktree on another branch legitimately owns a different
one, and Postgres does not refuse the drop while it is only being *copied* from —
sweeping mid-run makes every `CREATE DATABASE … TEMPLATE` in the neighbouring run
fail on a database that just vanished. `make test-clean-templates` sweeps on
purpose, when nothing is running. **Never hand-name a database for a one-off run**
(`ragworks_verify_final`, `ragworks_issue76_test`): a name outside the harness's
worktree-derived scheme belongs to no worktree, so no sweep can ever prove it is
dead and it survives every cleanup forever — take the database the Makefile targets
give you.

# Bug fixes require a regression test

Whenever a bug is fixed, a regression test must be written alongside the fix, **in the
same commit** — verified red-green: run the test without the fix and watch it fail for
the bug's reason, then apply the fix and watch it pass. This is how the test suite
grows: on things we know were broken, not on coverage padding. A bug fix PR with no
failing-then-passing test is incomplete.

# Branches

- Branch names are `type/short-slug`, with `type` drawn from the commit types
  (`feat/`, `fix/`, `test/`, `docs/`, `refactor/`, `chore/`, `ci/`) — one
  convention across branch, commit subject, and PR title, so history reads as one
  system.
- Never open a PR from an auto-generated `claude/<slug>-<hash>` branch — the
  harness names worktree branches before any instruction loads, so the rule
  targets the outcome: push with `git push origin HEAD:refs/heads/type/slug` and
  open the PR from the clean name, while continuing to work locally on the
  auto-named branch.

# Commits

- Subjects are conventional-commit style with a scope: `type(scope): summary`, e.g.
  `feat(pipelines): …`, `fix(ui): …`, `test(chat): …`, `docs: …`. Types: `feat`,
  `fix`, `test`, `docs`, `refactor`, `chore`, `ci`. The scope names the feature area
  or subsystem that changed, lowercase; omit it only when nothing narrower than the
  whole repo fits (`docs: …`).
- Never use the `!` breaking marker (`feat!:`) — breaking changes are flagged with
  the `breaking` PR label, which is what release notes are built from.
- Imperative mood, no trailing period, ≤72 characters. Add a body when the *why*
  isn't obvious from the subject: one short paragraph wrapped at 72 characters,
  stating the why — never a file inventory, which restates what the diff already
  shows.
- No AI attribution trailers (`Generated with Claude Code`, `Co-Authored-By:
  Claude`) in commits or PR descriptions — commits read as project work.
- Commit as you go on a branch: small, coherent commits per logical step — never one
  squashed mega-commit at the end of the work.
- A bug fix and its regression test share one commit (see above).
- When squash-merging, replace GitHub's default body (which concatenates every
  branch commit) with a paragraph or two of the why, distilled from the PR
  description — branch commits keep the detail; `main`'s history stays readable.

# Pull requests

- Work on a branch; merge to `main` via PR.
- The PR title follows the commit-subject convention, and the description links
  the issue (`Refs #N` / `Closes #N`).
- **The description is a short narrative of what changed and why — decisions, not
  inventory.** A few paragraphs of prose covering what changed, why it was needed
  (unless the linked issue already carries the why), and the judgment calls made
  along the way — the user's and the agent's alike, written as one voice — with
  their reasoning inline, so a future reader learns why the code is the way it is.
  No bullet-per-file listings, nothing the diff already shows, no test-count or
  coverage recitation — padding buries the decisions the description exists to
  record. "What changed" / "Why" / "Verification" is the natural heading shape,
  not a mandatory template; these rules calibrate agents, and a human writing a
  PR keeps their freedom.
- **Verification is 2–3 lines** naming the gates run (`make verify`,
  `npm run verify`, …) and any live sandbox/browser testing.
- **Never hard-wrap the description.** GitHub renders single newlines in PR and
  issue bodies as real line breaks, so a body wrapped at 72/80 characters renders
  with ragged mid-sentence breaks. Each paragraph is one line.
- **The description is one living document.** After review rounds, follow-up
  commits, or merging `main`, rewrite it in place so it always describes the
  final state of the branch — never append "post-review updates" or
  changelog-of-the-PR sections, which turn the record of the change into a diary
  of its review.
- If a change spans the API contract (backend schemas + frontend types), update both
  sides in the same PR so they can't drift — and say so in the description. Same for
  the `docker-compose.yml` ↔ README mirror (below).
- Every PR carries at least one release-notes label (`breaking`, `feature`, `fix`,
  `docs`, `ci`, `dependencies`, `chore`, or `skip-changelog`) — the `PR labels` check
  fails without one. Only `breaking`/`feature`/`fix` PRs appear in release notes
  (`.github/release.yml` excludes the rest), so the title of a PR carrying one of
  those labels is a published release-note line: write it as a user-facing
  statement of what changed, not an implementation note — a reader of the release
  page sees the title verbatim, with no diff beside it.
- **A merged PR cleans up what it created**, in this order: `make
  clean-worktree-dbs` (from inside the worktree, while it still exists — the target
  derives this worktree's own database names, so it cannot reach a neighbouring
  run), then delete the local branch, then `git worktree remove` **from the main
  checkout** — a worktree cannot remove itself while you are standing in it.
  The target also drops databases whose worktree no longer exists — the name
  encodes the worktree path, so a key matching no live worktree is orphaned by
  definition and nothing can be running in it. That is the safety net for the
  session that ends before it cleans up, which is why cleanup can't rest on the
  rule alone. Never hand-write a `LIKE 'ragworks%'` sweep: it matches every other
  worktree's databases too, and dropping one mid-run makes the neighbouring suite
  fail on a database that just vanished.

# Releases

Docker is the release vehicle, and releases go through a **release PR** — never a
push straight to `main`, and never a hand-created tag. `make
bump-patch|bump-minor|bump-major` (pre-releases: `make bump-rc`, SemVer `-rc.N`), or
the **Open release PR** workflow-dispatch button, runs `scripts/bump_version.py`: it
bumps the version on a `release/v<version>` branch and opens a PR — it does **not**
push to `main` or create the tag. Merging that PR fires `release.yml`, which tags the
merge commit, publishes multi-arch `ghcr.io/neeeser/ragworks-backend` / `-frontend`
images (`X.Y.Z` + `X.Y` + `latest` for stable, `X.Y.Z-rc.N` alone for pre-releases),
and cuts the GitHub Release with label-organized notes (only
`breaking`/`feature`/`fix` PRs appear; `docs`/`ci`/`dependencies`/`chore` are
excluded). The release PR body carries a `## Highlights` section — hand-written
prose edited any time before merge — which `release.yml` prepends above the
generated PR list; left as its seeded comment, the release ships generated notes
alone. The version lives in
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
  the frontend straight at the backend, `DEBUG=true`. **The dev database is the
  Dockerized ParadeDB from `docker-compose.dev.yml` — Docker is required for
  local dev and `make run`/`make test` start it for you.** It provides
  `pgvector` + `pg_search` so hybrid/BM25 search matches the release image. A
  Postgres without `pg_search` (e.g. an external `DATABASE_URL` override pointing
  at a bare server) silently loses BM25, so a green run there is not proof a
  search-touching change is correct — verify against the ParadeDB dev DB. The
  resolution lives in the `Makefile` (Docker, or external when `DATABASE_URL` /
  `TEST_DATABASE_URL` is set — each controls only its respective app or test
  target and is left unmanaged) + `scripts/ensure_postgres.py`; the dev database
  is loopback-only, and remote Docker contexts must use an explicit external URL;
  the shipped `docker-compose.yml` (release artifact) stays separate and
  untouched.
- **Docker**: `docker-compose.yml` — the primary target, because Docker is the
  release format. Same-origin `/api/*` through the runtime middleware proxy, no
  build-time API URL, `DEBUG=false`, secrets/volumes as described under Releases.

The modes differ in exactly the ways that hide bugs: how the frontend reaches the
API (direct URL vs runtime proxy), env-var timing (dev reads them live; a Docker
image bakes build-time values), debug defaults, and storage paths. When a change
touches startup, config, routing, storage, or anything env-dependent, verify it in
(or reason it through for) both modes — "works with `make run`" alone is not done.

# End-to-end testing — seeded scenarios, never manual setup

Before any browser testing, read `sandbox/AGENTS.md` — it holds the testing
workflow. Manual end-to-end testing never starts from a blank app: `uv run python -m
sandbox up <scenario>` seeds a named application state into an isolated
sandbox (own DB, storage, ports) and prints the login, a ready JWT, and deep
links — registering accounts and walking the setup wizard by hand wastes the
tokens the harness exists to save. Validated browser flows are saved as
Playwright specs in `frontend/flows/<scenario>/` and rerun with `uv run python
-m sandbox flows` — rerun or extend a saved flow before re-deriving it click
by click. The scenario catalog is `docs/sandbox-scenarios.md` (generated —
never hand-edited); usage is `docs/sandbox.md`; the harness's own
engineering rules, plus the add-a-scenario and add-a-flow checklists, live
in `sandbox/AGENTS.md`. When a feature needs a state or flow that doesn't
exist yet, add it in the same PR as the feature — that is how the catalog
and flow suite stay useful. Sandbox testing runs against real provider keys
(`.env.sandbox`) on purpose; if a provider-specific feature can only be
exercised with a mock or placeholder key, tell the user before reporting
results — a mocked run is not evidence the provider integration works.

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
  default models** — shipped model ids rot as providers retire them, so a hardcoded
  default eventually 502s every first upload. Model choices are always explicit
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
  small alias set — deliberately narrow, so mis-cased keys are dropped, not fixed.
  Send canonical snake_case keys.
- **Planning artifacts stay ignored.** Never force-add or commit `docs/superpowers/`;
  they are disposable working notes, not maintained project documentation.
- **Use the shared cache layer for user-visible repeated work.** Do not add feature-local
  cache engines; shared lifecycle and invalidation rules prevent stale-state bugs.

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
- `make server` / `make frontend` / `make run`: run backend, frontend, or both
  (dev). The DB-backed targets (`server`, `test`, `verify`, …) first run
  `scripts/ensure_postgres.py`, which starts the Dockerized ParadeDB dev DB
  (Docker required) or waits on an external `DATABASE_URL` / `TEST_DATABASE_URL`
  when one is set
- `make verify`: the backend gate — typecheck → lint → test with coverage
- `make test` / `make test-frontend`: backend (pytest) / frontend (vitest) tests
- `make typecheck`: `mypy app` (strict); `make lint`: ruff on backend code
- `make lint-frontend` / `make format-frontend` / `make format-check-frontend`:
  ESLint / Prettier write / Prettier check on `frontend/`
- `make readme-assets`: regenerate the README pipeline animations and posters
- `make bump-patch|bump-minor|bump-major|bump-rc`: open a release PR (see Releases —
  these never push to `main` or create tags themselves)

# Maintaining skills (`.claude/skills/` + `.agents/skills/`)

Skills are reusable reference guides agents load before matching work —
`ragworks-ui-design` is the design system every frontend change follows. Rules for
writing and updating them (they follow Anthropic's and OpenAI's skill-authoring
guidance):

- **A skill documents the present, never the past.** No removed patterns, deprecations,
  migration steps, or "why we deleted X" — git history owns that, and stale narrative
  teaches future agents about code that no longer exists. Every file, component, or
  command a skill names must exist in the repo right now; verify references when editing.
- **The `description` frontmatter states when to load the skill**, in the language of a
  real task, not a summary of its contents or of a one-time effort — an agent decides
  from the description alone whether to read further.
- **SKILL.md is an overview pointing at reference files one level deep**; keep it
  concise and put heavy detail in `references/`.
- **When the user clarifies a design decision, philosophy, or direction, update the
  relevant skill in the same PR** — that is how future agents inherit decisions made in
  conversation.
- **`.claude/skills/<name>/` and `.agents/skills/<name>/` stay byte-identical.** Author
  in `.claude/`, copy over, and diff-verify (each skill's own editing section carries the
  commands).

# Maintaining these AGENTS.md files

These files are lessons learned about writing good, consistent code in this repo.
The structure is fixed at four files — this root file for repo-wide design, infra,
CI, and release rules; `app/AGENTS.md`, `frontend/AGENTS.md`, and
`sandbox/AGENTS.md` for their areas. No nested AGENTS.md files deeper in the tree.

**Adding a rule.** When a fix, incident, or review teaches a durable rule, add it to
the relevant AGENTS.md **in the same PR** — never batched later. A rule earns its
place by capturing a non-obvious repo invariant or a proven failure mode; write it
as a concise imperative plus one line of *why* (the failure it prevents). That
one-line why is load-bearing, not decoration — a bare imperative is easy to
rationalize around; "nothing was written and the test still passed" is not. **Write
the why as a present-tense failure mode, never as repo history**: no "we once
had…", no counts of deleted copies, no references to removed code — git history
owns the past, and these files must always point forward (a rule that depends on
knowing what was removed teaches nothing to an agent arriving cold). When the user
clarifies a design decision or philosophy, record it here (or in the relevant
skill) in the same PR. Put the
rule in the narrowest file where it always applies, and state it once — a child file
extends the root, it never restates or contradicts it.

**What doesn't belong.** Generic language/framework advice, transient feature
status, tutorials, and facts easily discovered from the code. Known gaps and tech
debt become GitHub issues, not AGENTS.md sections — a "tracked" claim with no issue
behind it is how stale text accumulates. When work surfaces a gap worth tracking,
don't interrupt the task and never open the issue unprompted: finish the task, then
list the candidate issues and open only the ones the user confirms.

**Editing or condensing these files is high-risk** — deleting the wrong sentence
silently weakens every future change. Treat it as a behavior-preserving refactor:
classify each block (keep / condense / correct / remove) before touching it, keep
every rule plus its one-line why, and never move a rule somewhere with a weaker
loading trigger than the file it's in. While editing, verify that every referenced
path still exists and that the files don't contradict each other or the
Makefile/workflows — stale prose loses to mechanical sources, and a summary that
disagrees with the process it sits next to is worse than no summary. Prune rules
when the architecture or enforcement that motivated them changes.
