# Contributing to Ragworks

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

## Cutting a release

Releases are fully automated by CI — pushing a `v*` tag is the only trigger.
There is no manual step on GitHub: the workflow runs the CI gates, publishes
multi-arch Docker images (`ghcr.io/neeeser/ragworks-backend` / `-frontend`),
and creates the GitHub Release with auto-generated notes (organized by PR
labels via `.github/release.yml`) and `docker-compose.yml` attached.

From an up-to-date `main`:

```bash
make bump-patch   # 0.1.0 -> 0.1.1   (bug fixes)
make bump-minor   # 0.1.1 -> 0.2.0   (new features)
make bump-major   # 0.2.0 -> 1.0.0   (breaking changes)
make bump-rc      # 0.1.1 -> 0.1.2-rc.1, or 0.1.2-rc.1 -> -rc.2  (pre-release)
```

Each bump target updates the version in `pyproject.toml` and
`frontend/package.json` (only `scripts/bump_version.py` writes it), commits,
and creates the `v<version>` tag locally. Nothing is published yet — then push
exactly what the command prints:

```bash
git push origin main v0.1.1
```

That push kicks off the Release workflow; when it finishes, the release is
live on the Releases page. Bumping from an `-rc.N` version with `bump-patch`
finalizes it (e.g. `0.1.1-rc.3 -> 0.1.1`). Pushes to `main` without a tag
publish `edge` images only, never a release.

## Reporting issues

Open a GitHub issue with reproduction steps, expected vs. actual behavior, and
any relevant trace output — pipeline run traces usually pinpoint the failing
node.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
