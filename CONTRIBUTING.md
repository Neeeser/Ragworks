# Contributing to TransparentRAG

Thanks for your interest in contributing! This project keeps its engineering
practices in-repo, next to the code they govern — reading them first will save
you a review round-trip:

- [AGENTS.md](AGENTS.md) — repo-wide rules: verify gates, commit conventions,
  the bug-fix regression-test rule
- [app/AGENTS.md](app/AGENTS.md) — backend practices (FastAPI + Pydantic v2)
- [frontend/AGENTS.md](frontend/AGENTS.md) — frontend practices (Next.js + React 19)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local setup and workflows

## Quick start

```bash
make env        # install backend (uv) + frontend (npm) deps
make run        # backend + frontend together
```

Requirements: Python 3.11+, Node 22 (see `frontend/.nvmrc`), a local Postgres,
and (for the live features) OpenRouter/Pinecone API keys.

## Before you open a PR

Nothing ships without its gate passing. Run the gate for every area you changed:

- **Backend:** `make verify` (typecheck → lint → test)
- **Frontend:** `cd frontend && npm run verify`, plus `make format-check-frontend`

Both gates also run in CI on every pull request.

Other rules that will come up in review:

- **Bug fixes need a regression test in the same commit**, verified red-green:
  watch it fail without the fix, then pass with it.
- **Conventional-commit subjects**, scoped: `feat(pipelines): …`, `fix(ui): …`.
- **One concern per PR.** If a change spans the API contract, update backend
  schemas (`app/schemas/`) and the mirrored frontend types
  (`frontend/src/lib/types/`) in the same PR.

## Reporting issues

Open a GitHub issue with reproduction steps, expected vs. actual behavior, and
any relevant trace output — pipeline run traces usually pinpoint the failing
node.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
