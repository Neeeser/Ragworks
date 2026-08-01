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
| `backend-swap` | shared-pipelines plus a Pinecone connection and registered index: both backends are selectable, so binding-index swaps and the count/facet capability refusals can be exercised for real. | `OPENROUTER_API_KEY`, `PINECONE_API_KEY` |
| `blank` | Empty database — for testing registration, login, and the setup wizard itself. | none |
| `cohere-connected` | Admin user with a working Cohere connection (API key from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation. | `COHERE_API_KEY` |
| `collection-ready` | Setup complete: OpenRouter connection, hybrid default pipelines, and a collection with three ingested sample documents (real chunks and vectors). | `OPENROUTER_API_KEY` |
| `connected` | Admin user with a working OpenRouter connection, but no index or collection — the setup wizard resumes at index/collection creation. | `OPENROUTER_API_KEY` |
| `diagnostics-mismatch` | collection-ready, then retrieval re-pointed at a different embedding model: the embedding_model_mismatch diagnostic fires and search fails with a trace-linked error. | `OPENROUTER_API_KEY` |
| `evals-ready` | collection-ready plus a ready BEIR-format eval dataset whose queries target the seeded documents — eval runs can be created immediately. | `OPENROUTER_API_KEY` |
| `fresh-user` | Admin account exists; no providers, indexes, or collections — the setup wizard shows from its first step. | none |
| `insights-corpus` | collection-ready's wizard path with a ~100-document, multi-chunk corpus built from 20 newsgroups and embedded with MiniLM — the Visualize page shows real clusters, document ties, and cross-document overlaps. | `OPENROUTER_API_KEY` |
| `mcp-connected` | collection-ready plus a full-capability MCP API key — the collection's MCP endpoint answers tools/list and tools/call immediately. | `OPENROUTER_API_KEY` |
| `multi-provider` | Admin user with live OpenRouter, OpenAI, and Anthropic connections — three chat dialects available at once for cross-provider comparison. | `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| `multi-provider-ready` | collection-ready plus live OpenAI and Anthropic connections — cross-provider chat flows run against a wizard-complete console. | `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| `ollama-connected` | Admin user with a working Ollama connection (base URL from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation. | `OLLAMA_BASE_URL` |
| `shared-pipelines` | collection-ready plus a second collection bound to *copies* of its pipelines, writing to its own dense + BM25 indexes — the state a pipeline copy exists to produce. | `OPENROUTER_API_KEY` |

## `backend-swap`

shared-pipelines plus a Pinecone connection and registered index: both backends are selectable, so binding-index swaps and the count/facet capability refusals can be exercised for real.

Requires: `OPENROUTER_API_KEY`, `PINECONE_API_KEY` in `.env.sandbox`.

After seeding:
- everything from shared-pipelines (two collections sharing one pipeline pair on their own pgvector indexes)
- a live-validated Pinecone connection
- registered Pinecone indexes sandbox-remote (dense, sized to the embedding model) and sandbox-remote-bm25 (sparse) — both planes, so a lexical slot can be pointed at Pinecone and refused on capability rather than on vector type
- a tool binding can be repointed from pgvector to Pinecone from the collection's Indexes control
- a count or facet pipeline is refused on Pinecone, naming the nodes that cannot run there

## `blank`

Empty database — for testing registration, login, and the setup wizard itself.

After seeding:
- no users (the first account registered becomes admin)
- no provider connections, indexes, pipelines, or collections
- the frontend lands on signup; after login the setup wizard gates the console

## `cohere-connected`

Admin user with a working Cohere connection (API key from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation.

Requires: `COHERE_API_KEY` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated Cohere connection (embeddings + reranking)
- pgvector is available as the vector store; no index or collection yet

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

## `diagnostics-mismatch`

collection-ready, then retrieval re-pointed at a different embedding model: the embedding_model_mismatch diagnostic fires and search fails with a trace-linked error.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready (admin user, OpenRouter connection, hybrid pipelines, 3 ingested documents)
- retrieval re-pointed at openai/text-embedding-3-large while ingestion indexed with openai/text-embedding-3-small
- the Diagnostics tab shows an embedding_model_mismatch error and the Overview widget reads inconsistent
- a search fails at the retriever with a dimension mismatch, linking to its run trace

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

## `insights-corpus`

collection-ready's wizard path with a ~100-document, multi-chunk corpus built from 20 newsgroups and embedded with MiniLM — the Visualize page shows real clusters, document ties, and cross-document overlaps.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated OpenRouter connection (embeddings + chat)
- a pgvector dense index sized to all-minilm-l6-v2 (384d)
- hybrid default ingestion + retrieval pipelines (dense + BM25, RRF-fused)
- collection "Insights Corpus": ~100 ready documents from 8 newsgroup topics, several chunks each (hundreds of chunks total)
- a ready insight snapshot: PaCMAP map with labelled clusters, document graph edges, and a populated overlap report

## `mcp-connected`

collection-ready plus a full-capability MCP API key — the collection's MCP endpoint answers tools/list and tools/call immediately.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready
- API key "Sandbox agent" scoped to the seeded collection with tools:invoke, files:read, and files:write
- the key (printed in the handoff as an `mcp key` fact) is the only way to reach the endpoint; it is unrecoverable afterwards
- pointing any MCP client at the printed endpoint with `Authorization: Bearer <key>` is the remaining action under test

## `multi-provider`

Admin user with live OpenRouter, OpenAI, and Anthropic connections — three chat dialects available at once for cross-provider comparison.

Requires: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated OpenRouter connection (embeddings + chat + reranking)
- a live-validated OpenAI connection (embeddings + chat, Responses dialect)
- a live-validated Anthropic connection (chat only)
- pgvector is available as the vector store; no index or collection yet

## `multi-provider-ready`

collection-ready plus live OpenAI and Anthropic connections — cross-provider chat flows run against a wizard-complete console.

Requires: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready
- a live-validated OpenAI connection (embeddings + chat, Responses API)
- a live-validated Anthropic connection (chat only)

## `ollama-connected`

Admin user with a working Ollama connection (base URL from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation.

Requires: `OLLAMA_BASE_URL` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated Ollama connection (embeddings + chat) at OLLAMA_BASE_URL
- pgvector is available as the vector store; no index or collection yet

## `shared-pipelines`

collection-ready plus a second collection bound to *copies* of its pipelines, writing to its own dense + BM25 indexes — the state a pipeline copy exists to produce.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready (admin user, OpenRouter connection, hybrid pipelines, 3 ingested documents)
- a second collection "Second Collection" bound to *copies* of the ingest and tool pipelines, with no documents of its own
- indexes second-index (dense) and second-index-bm25 (sparse), registered and named by the copied pipelines' store nodes
- the index registry lists four registered indexes and reports which collections use each
- editing the original pipelines changes only the first collection — the copies are independent graphs
