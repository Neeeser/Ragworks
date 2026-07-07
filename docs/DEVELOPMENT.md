# Development Guide

Everything you need to run, test, and contribute to TransparentRAG. For what the
project *is*, see the [README](../README.md). For binding engineering rules, see
[`AGENTS.md`](../AGENTS.md) (repo-wide), [`app/AGENTS.md`](../app/AGENTS.md)
(backend), and [`frontend/AGENTS.md`](../frontend/AGENTS.md) (frontend).

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- Node 22 (pinned in `.nvmrc`)
- Postgres (local instance; `make server` will try to start it — set
  `POSTGRES_DATA_DIR` or `POSTGRES_START_COMMAND` if needed)

## Setup

```bash
make env       # uv sync --locked + npm install in frontend/
```

Create `.env.local` (or `.env`) in the repo root. Provider API keys (OpenRouter,
Pinecone) are configured **per user in the UI**; the `TEST_` keys are only needed
for the live integration test suite.

```ini
# Auth / DB
JWT_SECRET_KEY=super-secret-string
DATABASE_URL=postgresql+psycopg://localhost:5432/transparentrag
FILE_STORAGE_PATH=./storage

# OpenRouter defaults
OPENROUTER_SITE_URL=https://transparent-rag.local
OPENROUTER_SITE_NAME=TransparentRAG
OPENROUTER_DEFAULT_EMBEDDING_MODEL=qwen/qwen3-embedding-0.6b
OPENROUTER_DEFAULT_CHAT_MODEL=openai/gpt-oss-120b

# Pinecone defaults
PINECONE_INDEX_NAME=transparent-rag
PINECONE_REGION=us-east-1
PINECONE_CLOUD=aws

# Live integration tests only (optional)
TEST_OPENROUTER_API_KEY=...
TEST_PINECONE_API_KEY=...
```

> **Deployments must set `DEBUG=false`.** The fail-fast guard on the default JWT
> secret only arms outside debug mode. CORS origins are settings-driven
> (default `http://localhost:3000`).

## Running

```bash
make run        # backend (:8000) + frontend (:3000) together
make server     # backend only: uvicorn app.api.main:app --reload
make frontend   # frontend only (sets NEXT_PUBLIC_API_BASE_URL)
```

The startup hook initializes the Postgres schema if it's missing. The frontend
talks to whatever `NEXT_PUBLIC_API_BASE_URL` points at (default
`http://127.0.0.1:8000`), so you can point the UI at any FastAPI host without
rebuilding.

## API surface (high level)

| Route | Description |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/token`, `GET /api/auth/me` | Onboarding + JWT auth |
| `GET /api/models` | Cached OpenRouter model catalog |
| `GET/POST/PATCH/DELETE /api/collections` | Collection CRUD |
| `POST /api/collections/{id}/documents` | Upload → ingestion pipeline run |
| `POST /api/collections/{id}/query` | Retrieval pipeline run (transparent search) |
| `POST /api/collections/{id}/chat` | Multi-turn chat with tool calling, SSE streaming |
| `GET/POST /api/pipelines`, `POST /api/pipelines/validate` | Pipeline graph CRUD + validation |
| `GET /api/traces/...` | Per-run, per-node execution traces |
| `GET /api/indexes` | Pinecone index management |
| Visualization routes | UMAP projections of chunk embeddings |

Interactive docs at `http://localhost:8000/docs` once the server is running.

## Architecture

Layered, with a strict import direction — never upward:

```
core ← schemas ← db/clients ← domain packages (chat, pipelines, retrieval, visualization) ← services ← api
```

```
app/
  core/          settings + security (JWT, bcrypt)
  schemas/       the wire contract — Pydantic models, one module per domain
  db/            engine/bootstrap/migrations + models/ + repositories/ (per-domain)
  clients/       typed OpenRouter + Pinecone clients
  chat/          chat subsystem: facade, run loop, tools, branching, SSE events
  pipelines/     pipeline engine: nodes, registry, validation, execution, tracing
  retrieval/     pluggable RAG stages: chunkers, embedders, indexers, parsers,
                 rerankers, retrievers
  visualization/ UMAP projection compute + persistence
  services/      business logic + typed domain errors (errors.py)
  api/routes/    thin routes: parse → one service call → translate errors
tests/           mirrors app/ layout; tests/integration/ is the opt-in live suite
frontend/
  src/app/       Next.js App Router routes (thin shells)
  src/components/ feature folders (chat-studio/, collections/, pipelines/, ui/)
  src/lib/       api/ (the only place fetch lives), types/ (hand-mirrored wire types)
```

Key invariants (full detail in the AGENTS.md files):

- **Services raise typed domain errors** (`NotFoundError` → 404,
  `InvalidInputError` → 400, `ExternalServiceError` → 502); routes translate
  once via `to_http_exception`.
- **The wire contract is defined once** in `app/schemas/`; frontend types in
  `frontend/src/lib/types/` hand-mirror them and change in the same PR.
- **Pipeline resolution has one home** (`app/services/pipeline_resolution.py`);
  run lifecycle has one owner (`PipelineRunner`).
- **All query logic lives on repositories**; schemas and db models never mix.

## Testing & quality gates

Nothing ships without its gate passing:

```bash
make verify              # backend gate: mypy strict → ruff + pylint → pytest
make coverage            # coverage run (floor enforced; review term-missing)
cd frontend && npm run verify   # frontend gate: tsc → eslint → vitest
make format-check-frontend
```

- The unit suite runs **without live credentials** against a real Postgres.
- `make test-integration` runs `tests/integration/` against real
  OpenRouter/Pinecone (requires the `TEST_*` keys).
- Module size is capped at 400 lines, enforced by `tests/test_module_size.py`.
- **Every bug fix ships with a red-green regression test in the same commit.**

## Conventions

- Conventional-commit subjects, scoped: `feat(pipelines): …`, `fix(ui): …`.
- Work on a branch; merge to `main` via PR; one concern per PR.
- Before touching Pinecone/OpenRouter integrations, read the local docs in
  `docs/external-api/` — they match the pinned versions. The directory is
  gitignored; fetch it with `node scripts/download-openrouter-docs.mjs` and
  `node scripts/download-pinecone-docs.mjs`.
- When a fix teaches a rule, add it to the relevant AGENTS.md in the same PR.

## Make command reference

| Command | What it does |
| --- | --- |
| `make env` | Install backend (uv) + frontend (npm) deps |
| `make run` / `make server` / `make frontend` | Run both / backend / frontend |
| `make verify` | Backend gate: typecheck → lint → test |
| `make test` / `make test-frontend` | Backend / frontend unit tests |
| `make test-integration` | Live-credential backend suite |
| `make coverage` / `make coverage-frontend` | Coverage (fails on test failure) |
| `make coverage-open` / `make coverage-open-frontend` | Open HTML coverage reports |
| `make typecheck` / `make lint` | mypy strict / ruff + pylint |
| `make lint-frontend` / `make format-frontend` / `make format-check-frontend` | ESLint / Prettier |

## Known gaps (tracked)

- No CI yet — `make verify` / `npm run verify` are discipline-enforced; wiring
  them into GitHub Actions is the highest-value next step.
- Frontend wire types are hand-mirrored; generating from `/openapi.json` via
  `openapi-typescript` would eliminate drift.
- Provider API keys are stored plaintext at rest (wire exposure is guarded by a
  secret-exclusion contract test).
- Document upload has no size/content-type limit yet.
- No E2E test layer (Playwright/Cypress).
