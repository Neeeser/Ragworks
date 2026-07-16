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

Requirements: Python 3.11+, Node 22 (see `frontend/.nvmrc`), a local Docker daemon
(required — `make run`/`make test` start a Dockerized ParadeDB database for you so
BM25/hybrid search and its tests run), and (for the live features)
OpenRouter/Pinecone API keys. See
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#the-dev-database) for details.

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

Releases go through a **release PR** — nothing is pushed straight to `main`, and
merging the PR is what publishes. From an up-to-date `main`:

```bash
make bump-patch   # 0.1.2 -> 0.1.3   (bug fixes)
make bump-minor   # 0.1.2 -> 0.2.0   (new features)
make bump-major   # 0.2.0 -> 1.0.0   (breaking changes)
make bump-rc      # 0.1.2 -> 0.1.3-rc.1, or 0.1.3-rc.1 -> -rc.2  (pre-release)
```

Each command bumps the version in `pyproject.toml`, `frontend/package.json`, and
the lockfiles (only `scripts/bump_version.py` writes it), commits to a
`release/v<version>` branch, and opens a PR labelled `skip-changelog`. You can
also open the same PR from the Actions tab via the **Open release PR** workflow
(pick the bump level). Bumping from an `-rc.N` version with `bump-patch`
finalizes it (e.g. `0.1.3-rc.3 -> 0.1.3`).

Review the release PR — CI runs on it like any other — then **merge it**.
Merging triggers the Release workflow, which:

- tags the merge commit `v<version>`;
- builds and pushes the multi-arch images (`ghcr.io/neeeser/ragworks-backend` /
  `-frontend`) — `X.Y.Z` + `X.Y` + `latest` for a stable release, `X.Y.Z-rc.N`
  alone for a pre-release;
- creates the GitHub Release with notes organized by PR labels
  (`.github/release.yml`) and `docker-compose.yml` attached.

Because the tag is created by the workflow (not pushed by hand), a failed build
never leaves a dangling tag. Separately, every push to `main` publishes rolling
`edge` images (the Edge images workflow) for testing main — never a release.

## Reporting issues

Open a GitHub issue with reproduction steps, expected vs. actual behavior, and
any relevant trace output — pipeline run traces usually pinpoint the failing
node.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
