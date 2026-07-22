# Sandbox scenario catalog

Generated from the scenario registry by `uv run python -m sandbox docs` — do not
edit by hand (a test diffs this file against the registry). Usage, key setup,
and how to add scenarios: [sandbox.md](sandbox.md).

Seed any of these with `uv run python -m sandbox up <name>` (servers on
http://127.0.0.1:3010 / http://127.0.0.1:8010) or `... seed <name>` (state
only). Every seeded scenario with a user logs in as `sandbox@ragworks.dev` /
`ragworks-sandbox`; the seed command also prints a ready JWT.

| scenario | state | needs keys |
| --- | --- | --- |
| `blank` | Empty database — for testing registration, login, and the setup wizard itself. | none |
| `collection-ready` | Setup complete: OpenRouter connection, hybrid default pipelines, and a collection with three ingested sample documents (real chunks and vectors). | `OPENROUTER_API_KEY` |
| `connected` | Admin user with a working OpenRouter connection, but no index or collection — the setup wizard resumes at index/collection creation. | `OPENROUTER_API_KEY` |
| `evals-ready` | collection-ready plus a ready BEIR-format eval dataset whose queries target the seeded documents — eval runs can be created immediately. | `OPENROUTER_API_KEY` |
| `fresh-user` | Admin account exists; no providers, indexes, or collections — the setup wizard shows from its first step. | none |

## `blank`

Empty database — for testing registration, login, and the setup wizard itself.

After seeding:
- no users (the first account registered becomes admin)
- no provider connections, indexes, pipelines, or collections
- the frontend lands on signup; after login the setup wizard gates the console

## `collection-ready`

Setup complete: OpenRouter connection, hybrid default pipelines, and a collection with three ingested sample documents (real chunks and vectors).

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated OpenRouter connection (embeddings + chat)
- a pgvector dense index sized to the configured embedding model
- hybrid default ingestion + retrieval pipelines (dense + BM25, RRF-fused)
- collection "Sandbox Collection" with 3 ready documents (aurora-station, tidepool-protocol, glasswing-archive) — distinct topics for retrieval checks
- search, chat, traces, and visualizations all have real data behind them

## `connected`

Admin user with a working OpenRouter connection, but no index or collection — the setup wizard resumes at index/collection creation.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated OpenRouter connection (embeddings + chat)
- pgvector is available as the vector store; no index or collection yet

## `evals-ready`

collection-ready plus a ready BEIR-format eval dataset whose queries target the seeded documents — eval runs can be created immediately.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready
- eval dataset "Sandbox Eval Dataset" (ready): 3 queries with relevance judgments against the 3 seeded sample documents
- creating and scoring an eval run is the remaining user action under test

## `fresh-user`

Admin account exists; no providers, indexes, or collections — the setup wizard shows from its first step.

After seeding:
- one admin user (the standard sandbox login)
- no provider connections, indexes, pipelines, or collections
- GET /api/setup/status reports nothing ready; the wizard gates the console
