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
| `evals-corpus-gap` | evals-ready plus a completed eval run whose corpus holds one document that failed to index — the state the corpus retry action repairs. | `OPENROUTER_API_KEY` |
| `evals-multimodal` | multimodal-embed plus an eval dataset whose corpus documents are page images and whose queries include one asked with a picture — a completed run over it scores image retrieval end to end. | `COHERE_API_KEY` |
| `evals-ready` | collection-ready plus a ready BEIR-format eval dataset whose queries target the seeded documents — eval runs can be created immediately. | `OPENROUTER_API_KEY` |
| `fresh-user` | Admin account exists; no providers, indexes, or collections — the setup wizard shows from its first step. | none |
| `ingest-failures` | collection-ready plus three uploads that failed to ingest — the state the Files page's retry-failed action clears. | `OPENROUTER_API_KEY` |
| `insights-corpus` | collection-ready's wizard path with a ~100-document, multi-chunk corpus built from 20 newsgroups and embedded with MiniLM — the Visualize page shows real clusters, document ties, and cross-document overlaps. | `OPENROUTER_API_KEY` |
| `mcp-connected` | collection-ready plus a full-capability MCP API key — the collection's MCP endpoint answers tools/list and tools/call immediately. | `OPENROUTER_API_KEY` |
| `multi-provider` | Admin user with live OpenRouter, OpenAI, and Anthropic connections — three chat dialects available at once for cross-provider comparison. | `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| `multi-provider-ready` | collection-ready plus live OpenAI and Anthropic connections — cross-provider chat flows run against a wizard-complete console. | `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| `multimodal` | A collection ingesting images as well as prose: an uploaded photograph and a PDF whose figures are extracted, described by a vision model, and indexed beside the text. | `OPENROUTER_API_KEY` |
| `multimodal-embed` | A collection whose images are embedded directly by an image-capable model rather than described first — a text query reaches an image through the shared vector space, with no prose in between. | `COHERE_API_KEY` |
| `ollama-connected` | Admin user with a working Ollama connection (base URL from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation. | `OLLAMA_BASE_URL` |
| `search-variant` | collection-ready plus an unbound copy of the default retrieval pipeline — dense-only, same 'search' tool name — the state switching a collection's search tool runs against. | `OPENROUTER_API_KEY` |
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

## `evals-corpus-gap`

evals-ready plus a completed eval run whose corpus holds one document that failed to index — the state the corpus retry action repairs.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from evals-ready
- eval dataset "Corpus with a failed document": 3 queries, one whose gold document carries no text and cannot be chunked
- a completed eval run over it: 2 of 3 corpus documents indexed, 1 query recorded unscored, aggregates covering the other 2
- the run page and the dataset's corpora pane both offer 'Retry failed documents'

## `evals-multimodal`

multimodal-embed plus an eval dataset whose corpus documents are page images and whose queries include one asked with a picture — a completed run over it scores image retrieval end to end.

Requires: `COHERE_API_KEY` in `.env.sandbox`.

After seeding:
- everything from multimodal-embed (Cohere embed-v4.0, a shared text/image vector space, five ready documents)
- eval dataset "Sandbox Image Eval Dataset" (ready, modalities image + text): 4 corpus documents carrying image media and no text — galactic-center.jpg plus three generated figure pages — with 5 queries and one relevance judgment each
- 4 of those queries are text asking for what a page shows; the fifth carries no text at all, only the galactic-centre photograph, and its gold document is the corpus page holding that same image
- eval run "Image corpus run" (completed): the corpus ingested through the "Multimodal embedding" pipeline and queried through the collection's primary search tool, so metrics, the funnel, and per-query results are all populated
- starting another run over this dataset with the same ingestion pipeline reuses that eval collection, so it scores without re-ingesting the images

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

## `ingest-failures`

collection-ready plus three uploads that failed to ingest — the state the Files page's retry-failed action clears.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready
- 3 additional files (outage-1..3.pdf, bytes that are not a PDF) in `failed` state with the parse handler's real error, holding no chunks
- the Files page shows the failed-files notice and its 'Retry failed files' action

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

## `multimodal`

A collection ingesting images as well as prose: an uploaded photograph and a PDF whose figures are extracted, described by a vision model, and indexed beside the text.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready (connection, indexes, three text documents)
- pipeline "Multimodal ingestion" bound as the collection's ingestion pipeline: Extract Text, Extract Media, and Media File parsing the uploaded file in parallel, merged into one chunk/describe/embed/index chain
- galactic-center.jpg — a NASA composite of the galactic centre, read by the Media File node and searchable by what a vision model saw in it
- solar-figures.pdf — text extracted and chunked, plus two embedded figures (a solar flare image and a labelled sunspot chart) pulled out, described, and indexed alongside it
- searching for what the images depict returns them, so the describe-then-embed path can be checked end to end

## `multimodal-embed`

A collection whose images are embedded directly by an image-capable model rather than described first — a text query reaches an image through the shared vector space, with no prose in between.

Requires: `COHERE_API_KEY` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated Cohere connection serving embed-v4.0 (override with SANDBOX_MM_PROVIDER / SANDBOX_MM_EMBEDDING_MODEL)
- a pgvector index sized to that model, holding text and image vectors together
- pipeline "Multimodal embedding" bound as the collection's ingestion pipeline: Extract Text, Extract Media, and Media File parsing in parallel, merged into one chain where chunks, PDF figures, and uploaded images embed through the same model
- three text documents plus galactic-center.jpg and solar-figures.pdf, all ready
- searching for what an image depicts returns it with no description anywhere in the pipeline — the image vector itself is the match

## `ollama-connected`

Admin user with a working Ollama connection (base URL from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation.

Requires: `OLLAMA_BASE_URL` in `.env.sandbox`.

After seeding:
- one admin user (the standard sandbox login)
- a live-validated Ollama connection (embeddings + chat) at OLLAMA_BASE_URL
- pgvector is available as the vector store; no index or collection yet

## `search-variant`

collection-ready plus an unbound copy of the default retrieval pipeline — dense-only, same 'search' tool name — the state switching a collection's search tool runs against.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready (admin user, OpenRouter connection, hybrid pipelines, 3 ingested documents)
- a retrieval pipeline "Dense-Only Retrieval": a verbatim copy of the default with the BM25 retriever and RRF fusion removed
- that copy declares the same tool name ('search') as the bound default, so binding both at once is refused and switching must replace
- the copy is bound to no collection — the Overview's Search tool control is where it gets bound
- a query run after switching traces a 5-node graph, against the default's 7 — which pipeline served it is readable from the trace

## `shared-pipelines`

collection-ready plus a second collection bound to *copies* of its pipelines, writing to its own dense + BM25 indexes — the state a pipeline copy exists to produce.

Requires: `OPENROUTER_API_KEY` in `.env.sandbox`.

After seeding:
- everything from collection-ready (admin user, OpenRouter connection, hybrid pipelines, 3 ingested documents)
- a second collection "Second Collection" bound to *copies* of the ingest and tool pipelines, with no documents of its own
- indexes second-index (dense) and second-index-bm25 (sparse), registered and named by the copied pipelines' store nodes
- the index registry lists four registered indexes and reports which collections use each
- the copied retrieval pipeline declares the tool name 'search_second', so it and the original can both be bound to one collection
- editing the original pipelines changes only the first collection — the copies are independent graphs
