# TransparentRAG

TransparentRAG is a FastAPI backend (`app/`) with a Next.js frontend (`frontend/`).
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
- `make test-integration`: backend live-credential suite (hits real OpenRouter/Pinecone)
- `make coverage` / `make coverage-frontend`: coverage runs (fail on test failure)
- `make coverage-report` / `make coverage-report-frontend`: coverage, non-blocking
- `make coverage-open` / `make coverage-open-frontend`: open HTML coverage reports
- `make typecheck`: `mypy app` (strict)
- `make lint`: ruff + pylint on `app/` (and ruff on `tests/`)
- `make verify`: the backend gate — typecheck → lint → test
- `make lint-frontend` / `make format-frontend` / `make format-check-frontend`:
  ESLint / Prettier write / Prettier check on `frontend/`
