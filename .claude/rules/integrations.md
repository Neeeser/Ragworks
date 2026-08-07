---
paths:
  - "app/vectorstores/**"
  - "app/providers/**"
  - "app/clients/**"
  - "tests/vectorstores/**"
  - "tests/providers/**"
  - "tests/clients/**"
---

# Vector-Store Backends and Model Providers

Rules for the pluggable vector-store backends (`app/vectorstores/`), model
providers (`app/providers/`), and their typed clients (`app/clients/`).
`backend.md` applies here too.

## Vector-store backends (`app/vectorstores/`)

- **Adding a backend is a checklist:** implement `VectorStoreBackend` in a new
  package, declare its `VectorStoreCapabilities`, register in `registry.py`, add
  its `IndexBackend` enum value, and add one indexer + one retriever node subclass
  in `app/pipelines/nodes/` (shared bases own run/summarize/validation). The wizard
  and index manager pick it up from `GET /api/indexes/backends`.
- **Capabilities are data, declared once.** A backend's hard limits (max dimension,
  metrics/vector types, name rule, batch/top_k caps) live only on its
  `VectorStoreCapabilities`; every enforcement site — index validation, node
  validation, upsert batching, frontend forms — reads them off the backend.
  Re-hardcoding a limit anywhere else is a lockstep bug. Verified: pgvector caps at
  4,096 indexed dims (fp32 HNSW stops at 2,000; above that the HNSW index is built
  over a `halfvec` fp16 cast and queries must use the same cast or the planner
  skips the index — needs pgvector ≥ 0.7.0, checked at create time), Pinecone
  20,000. Query-conditioned aggregate planes are capabilities too:
  `supports_lexical_count`/`supports_lexical_facet` (ParadeDB/pgvector via SQL
  aggregate over the lex table; Pinecone has neither) gate the count/facet tool
  nodes and their wizard templates.
- **A store-bound node's `supported_backends` is capability-*derived*, never
  hand-listed.** `PipelineNodeBase.supported_backends()` returns `None` for
  store-agnostic nodes; store-bound overrides read the catalog via
  `backends_where(lambda c: c.supports_…)` (or pin a single backend for legacy
  variants). Hand-listing backends there duplicates the capability and drifts the
  moment a backend is added — the editor's "Only on …" node badge and the tool
  wizard's template gate both read this derived list.
- **`get_vector_store` is the single prerequisite gate.** Pinecone without a
  connection, or pgvector while the extension is unavailable, raises
  `InvalidInputError` there (→400). Routes never check vector prerequisites up
  front — enforcement is lazy, when a pipeline actually resolves to the backend.
- **pgvector dynamic DDL is safe only because names are validated first.** Data
  tables are `vec_<name>` (`-`→`_`); every identifier derives from an index name
  that passed the strict `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` rule (≤45 chars, shared
  with Pinecone). Values always travel as bound parameters; embeddings bind through
  `pgvector.sqlalchemy.VECTOR` typed bindparams (importing it also registers the
  type for reflection — `app/db/schema.py` relies on that).
- **Extensions are best-effort at bootstrap.** `ensure_pgvector_extension` runs
  `CREATE EXTENSION IF NOT EXISTS vector`; on failure it logs and flips the
  `app/db/pgvector_support.py` availability flag instead of failing startup.
  pg_search follows the same pattern (`app/db/pg_search_support.py`, clear
  `InvalidInputError` at sparse-index creation). **Run the suite against the
  Dockerized ParadeDB DB — `make test`/`make verify` start it for you
  (`docker-compose.dev.yml`, loopback-only port 54329); it ships the `pg_search`
  the release image runs.** On a Postgres without `pg_search` (e.g. a bare
  external `TEST_DATABASE_URL` override) the BM25 path is untested —
  `pg_search_session` tests skip with a named reason, so a green run there
  proves nothing for a sparse/hybrid change (the root `CLAUDE.md` dev-database
  rule). Dependent tests use the `pgvector_session`/`pg_search_session` fixtures.
  **A bare `uv run pytest` is not the gate**: it skips `make test`'s database
  setup and falls back to `DEFAULT_TEST_DATABASE_URL` (`localhost:5432`),
  where the BM25 tests skip — so it reports green on changes CI then fails,
  and the skip count is the only thing that says so. Run `make test`.
- **The lexical (BM25) plane mirrors the dense one, backend-natively.**
  `upsert_lexical`/`lexical_query` serve sparse indexes
  (`IndexSpec(vector_type="sparse")`): pgvector via ParadeDB pg_search BM25 over
  `lex_<name>` tables; Pinecone always creates sparse indexes with the integrated
  `pinecone-sparse-english-v0` model so raw-text upserts/searches work (a sparse
  index without integrated embedding can't be text-searched; text upserts cap at
  96/batch). A pipeline's sparse index is named `<dense>-bm25`
  (`bm25_sibling_index_name`, truncated to the shared 45-char rule).
- **Node type ids are permanent.** Persisted definitions reference
  `indexer.pgvector` etc. by string; a new backend adds ids, never renames.
  Retiring an id requires a startup migration that rewrites every stored
  definition (`app/services/provider_migration.py` is the pattern).
- **Per-document vector deletion goes through `delete_document_vectors`** (chunk
  vector ids are `{document_id}:{order}`). Never delete a whole namespace to remove
  one file.
- **An index a pipeline targets is a `RegisteredIndex` row, never a bare name.**
  Registration is what makes an index selectable, so *every* path that generates a
  pipeline (setup wizard, default scaffolding, the migration) routes its definition
  through `register_definition_indexes`
  (`app/services/index_scaffolding.py`) — a path that skips it leaves its indexes
  invisible to the index registry's in-use list and unselectable in every picker.
  Registration is *all* it does: the definition comes back unchanged, because
  making an index an entity and hoisting the choice out of the graph are separate
  decisions. Deleting a registration consults *declared*
  references (`IndexRegistryService.ensure_unused`), not observed runs: a pipeline
  that has not run yet still owns its index.
- **A destructive control-plane call checks `capabilities.shared_across_users`
  before it acts.** Registered-index identity is per user, but a pgvector name
  maps to one `vec_<name>` table for the whole deployment (accounts separated
  only by `namespace`), so deleting "my" index by name drops every account's
  vectors in it — `ensure_no_other_owner` refuses while another registration
  claims the name, and the caller's own registration is irrelevant because a
  shared name is visible, and deletable, to accounts that never registered it.
- **On a shared backend the destructive guard reads stored rows, not only
  registrations.** A registration is a declaration and unregistering deliberately
  leaves the data behind (it is what the refusal message recommends), so an
  account with vectors but no registration is invisible to a declaration-only
  check and the next caller's delete drops the table under them.
  `IndexAdminService._ensure_no_foreign_rows` asks the store for its
  `stored_namespaces` and refuses when one names another account's collection.
- **A shared backend's catalog listing is scoped to the caller.** One deployment
  Postgres holds every account's pgvector indexes, so an unscoped listing reads
  every other account's index names straight off the catalog — and a name
  describes the corpus behind it. `VectorIndexRecord.owner_user_id` is stamped at
  creation and `list_indexes`/`describe_index` show the caller's rows plus
  owner-less ones; owner-less stays visible on purpose, so an index created
  straight in Postgres is still adoptable rather than silently missing from a
  live collection's registry.
- **`namespace` is the only tenant boundary inside a shared index, so every node
  resolves it through `resolve_owned_namespace`.** It is an ordinary editable
  config field, and the default template makes a collection id the whole of the
  addressing — typing another account's `col-<uuid>` into a node pointed at a
  shared index otherwise returns their chunks, text included. Namespaces naming
  no collection stay allowed: they carry no ownership to enforce, and refusing
  them would strand a pipeline whose collection was deleted.
- **A store-bound node names its own index, and nothing outside the definition
  can change it.** An index's width is decided by the embedder beside it, so
  identity belongs in the graph — and a graph you can read tells you where data
  lands. `app/pipelines/index_identity.py` only *reads* identity back out (for
  registration) and converts legacy `{collection_id}` namespace templates. Any
  rule that folds a definition's store nodes onto one shared value merges two
  corpora into whichever is written last, silently: the run succeeds and
  retrieval returns the wrong chunks.
- **There is no per-collection variable source.** A binding says *which*
  pipeline runs and in what role, never what it does — a binding-overridden
  variable makes the definition stop describing what it does, and for an
  index the cost is invisible because retrieval returns nothing rather than
  failing. Input variables differ: they are the tool's public contract, vary
  per call, and never move where data lives. A pipeline that must differ per
  collection is a different pipeline — `copy_pipeline` is how you get one.
- **There is no per-collection node config either: creating a collection binds
  pipelines, it never clones one with edited node configs.** A clone made at
  creation time is a graph nobody ever opens again — it drifts from the
  pipeline it was copied from, and the editor's own validation (embedding
  limits, backend compatibility, expression taint) never sees the edit. Node
  configuration belongs to the pipeline editor; `CollectionCreate` carries
  pipeline *ids* and nothing else.
- **A user's collections are separated inside one index by `namespace`, not by
  having their own index.** One pipeline serves every collection a user owns
  without interference. Accounts are the separate concern: on a shared backend
  a name is one physical store for the whole deployment, so a default handing
  two accounts the same name interleaves their vectors where neither can see
  the other — index names offered to a user are derived per account.
- **Backend compatibility is a property of the saved definition, and the error
  names the nodes.** A node names its own index and an index carries its
  backend, so compatibility is checked when the pipeline is saved.
  `incompatible_nodes` (`app/pipelines/backend_support.py`) is the one check,
  read by validation and diagnostics; it lives in the engine because
  `app/pipelines` may not import from `app.services`. A bare "incompatible
  backend" leaves the user guessing which of a dozen nodes to change.
- **Which plane an index serves is derived from the node that reads it**, never
  from its name — an index called `secondary_index` feeding a BM25 retriever is
  a sparse index, and inferring from spelling mispicks the moment an author
  names one differently.

## Model providers (`app/providers/` + `provider_connections`)

- **A provider is a per-user connection row**, not a fixed slot: users may hold
  several connections of one type (two Ollama servers) unless the descriptor caps
  it (`max_connections_per_user=1` for Pinecone). Configs are validated through the
  per-type Pydantic models in `app/schemas/providers.py` before anything is
  written. Connection configs (API keys/URLs) are stored unencrypted at rest —
  never serialize them into any response
  (`test_connections_response_never_serializes_secret_values` guards the wire).
- **The layer mirrors `app/vectorstores/`**: a frozen `ProviderDescriptor` declares
  capability kinds (`EMBEDDING`/`CHAT`/`VECTOR_STORE`), the config-field catalog
  the UI renders from, docs link, and connection limits — declared once on the
  adapter class, read everywhere. `app/providers/registry.py` is the single
  construction + prerequisite gate (`resolve_connection` → ownership 404,
  `get_provider` → kind-mismatch 400); the lazy per-run `ProviderResolver` sits on
  `PipelineRunContext.providers`.
- **Chat provider implementations live in `app/providers/chat/`**, not `app/chat/`
  — `app.chat` depends on `app.providers`, never the reverse (the reverse is an
  import cycle). `ChatRequest` is the provider-neutral contract; each provider maps
  normalized options onto its own wire format (OpenRouter → `extra_body`; Ollama →
  `think`/`options`, `max_tokens` → `num_predict`, synthesized uuid tool-call ids).
- **A config model that rewrites what the user typed must have its result
  persisted, via `ProviderAdapter.normalized_config()`.** Validation runs through
  the model but the raw payload is what a caller hands the service, so storing
  that leaves the row — and every listing built from it — naming an address the
  provider is not reached at. Self-hosted server URLs normalize on save: a bare
  host gets `http://`, and an `http` URL with no port gets the provider's own
  default (`OLLAMA_DEFAULT_PORT`, `TEI_DEFAULT_PORT`), because a URL read off the
  user's own machine otherwise resolves to port 80 and fails with a bare
  connection error. An explicit port and any `https` URL are left alone — https
  implies 443 and a proxied endpoint.
- **Model identity is a structured pair** — `connection_id` + `model_name` — on the
  embedder node config, `ChatSession`, and `last_used_chat_*`; never a munged
  `"provider:model"` string in persisted data.
- **There are no eager provider-key route gates**: prerequisites are enforced
  lazily at the registry, mirroring `get_vector_store`. The unified catalog
  (`GET /api/models?kind=`) degrades per-connection (`connection_errors`) instead
  of failing when one provider is unreachable.
- **Ollama catalog classification never embeds.** `describe_models` reads
  `/api/show` capabilities + architecture metadata — probing `/api/embed` would
  load every model into server memory just to list them; the probe is a per-model
  fallback in `embedding_dimension` only.
- **A wire format is implemented once, in `app/providers/chat/dialects/`, and a
  provider composes one.** A dialect is a protocol, not a vendor:
  `ChatCompletionsProvider` is what OpenAI, OpenRouter, vLLM, llama.cpp, and LM
  Studio all speak. A vendor extension goes through the hook the dialect exposes
  (`build_extra_body`), never a forked parser — two copies of a stream parser
  drift, and the drift surfaces as a tool call that silently never runs.
- **Transport is separate from dialect** (`app/clients/openai_compat/`): one
  base URL + key + header set + pooled `httpx.Client`, with each surface (chat,
  Responses, embeddings, rerank, models, probe) a module over it. That split is
  what lets Responses and Chat Completions share a connection, and what makes a
  new OpenAI-compatible server cost a descriptor rather than a client.
- **A dialect declares its own parameter set; a catalog-backed provider stays
  strict about model ids.** `ModelInfo.supported_parameters` is what
  `sanitize_parameter_overrides` filters on, so a dialect that declared the
  wrong set silently drops the user's settings. A provider that supplies a
  model resolver has an authoritative catalog and must report an unknown id as
  unknown; one that supplies none (a server publishing bare ids) falls back to
  the dialect's parameters, or every knob is filtered out as unsupported.
- **Per-model capability comes from the provider's live catalog, never a shipped
  table.** Anthropic publishes `capabilities.thinking.types` and `effort` on
  `GET /v1/models`; the same generation that gained adaptive thinking rejects
  `temperature`/`top_p`/`top_k` with a 400, so both are derived from that
  response. A hardcoded family list starts 400-ing the moment the next family
  ships. Where a provider publishes nothing (OpenAI), infer *lopsidedly*: match
  the markers that exclude, and let everything unmatched fall through to the
  permissive bucket, so a model released tomorrow appears rather than vanishes.
- **A capability the provider documents nowhere is *measured* at bundle
  generation, never inferred from a version.** Whether an OpenAI model still
  accepts `temperature`/`top_p`/`top_logprobs` is published on no page and
  does not follow the version — gpt-5.4 accepts them, gpt-5.5 needs reasoning
  off, gpt-5 never does — so `make refresh-openai-bundle` probes it with one
  minimum-size request per reasoning model and records the answer. The probe
  skips models priced above the generator's ceiling, and anything unmeasured
  stays permissive; a version cutoff would be wrong in both directions on the
  day it was written.
- **OpenAI model capabilities come from the shipped bundle, and the bundle
  refines — it never gates.** `app/providers/openai_model_bundle.json` is
  generated from OpenAI's own docs pages (`make refresh-openai-bundle`; the
  `openai-model-bundle` skill has the workflow); an id it has never heard of
  falls back to the dialect's full parameter floor with no context claim,
  because a model OpenAI ships tomorrow must keep working from a stale bundle.
  Never hand-edit the JSON — fix the generator script and regenerate.
- **A dialect's parameter tuple is spelled in the canonical chat-parameter
  vocabulary, not the wire spelling.** Supported-parameter filtering runs
  against the tuple *before* the dialect's alias rename, so listing the wire
  name (`max_output_tokens`) filters the canonical key out and the rename
  never fires — the user's cap silently stops reaching the model.
- **A capability is a typed claim (`ChatCapabilities`), never a string in the
  sampling-knob list, and it never routes through the knob filter.** The two
  fail differently: a knob the model rejects comes back with the provider
  naming the field, so the permissive dialect floor is right, while a
  capability guessed wrong makes the request itself malformed — a reasoning
  block sent to a model that has none is a 400 the user cannot clear. For the
  same reason a capability *request* (the user's chosen reasoning effort) is
  read from the payload, not from the sanitized overrides: the filter keeps
  only knobs, so passing it through drops the choice silently and the turn
  runs at the model's default while the panel still shows the setting.
- **Where a floor must guess a capability, the guess follows the cost of being
  wrong** (`DIALECT_FLOOR_CAPABILITIES`): `tools` on, because a wrong guess is
  a named error and refusing it would lock retrieval out of a server that
  supports it; `reasoning` off, because a wrong guess breaks every turn and no
  setting undoes it.
- **`ChatParameters.extra_body` bypasses supported-parameter filtering by
  design and merges into the provider body last.** It exists precisely for
  knobs no catalog knows; filtering it, or letting a provider's own
  extensions win the merge, deletes the only escape hatch users have when a
  capability source is wrong. A key the server rejects surfaces the server's
  own error — there is deliberately no strip-and-retry layer anywhere in the
  chat path.
- **A provider requiring `max_tokens` gets an answer-sized default, not the
  model's ceiling.** A ceiling is a cap (64K–128K); Anthropic's SDK reads a
  request that large as one that may run over ten minutes and refuses to send it
  unbuffered — so defaulting to it makes every buffered turn fail before it
  leaves the process. Clamp an explicit value to the ceiling; default well below.
- **A capability probe reads the status, never the payload.** POST an empty body
  and discriminate 404 (absent) from 400/422 (present, rejecting our invalid
  body) — it costs no tokens, needs no model name, and works before the user has
  picked one. 401/403 is its own outcome: a gateway rejecting the key answers
  that way on *every* path, and reporting "this server has no chat endpoint"
  sends the user to fix the wrong field.
- **What a connection serves is stored on the row, not re-probed per call.** The
  probe is a suggestion the user confirms; a server that was briefly slow or
  down must not silently lose a capability its owner knows it has. For the same
  reason a guess may *order* a listing but never filter it — filtering hides a
  model the server actually serves whenever its naming differs.
- **A catalog entry states the modalities its provider publishes, on every
  kind it serves.** `input_modalities`/`output_modalities` are what the model
  pickers render capability marks from and what their capability filters
  narrow on, so a branch that drops them makes every model on that provider
  look text-only and hides the vision models the filter is for. Each
  adapter reads its provider's own positive statement — OpenRouter's
  `architecture` block, Ollama's `/api/show` capabilities, Anthropic's
  published `capabilities.image_input` — and a provider that publishes nothing
  claims nothing beyond text rather than guessing.
- **OpenRouter serves embedding models from `/embeddings/models`, and that
  listing carries its own `architecture` block.** It publishes the same
  `input_modalities` the chat listing does, so the embedding catalog reads it
  too — a multimodal embedding model that came back text-only would keep every
  pipeline on its text floor and route images nowhere.
- **Where a provider states nothing per model but the *endpoint* has one
  contract, the declaration is per endpoint.** Cohere publishes no modality
  field anywhere, and `/v2/embed` takes `input_type: "image"` for every embed
  model it serves (verified against both generations), so its embedding kind
  states image beside text. A shipped per-model table would go stale on the
  next release; a model that refused images would answer with Cohere's own
  error naming the input type.
- **Adding a provider type is a checklist**: config model in
  `app/schemas/provider_configs.py`, `ProviderType` enum value, adapter module
  with its descriptor, `ADAPTERS` registry entry, either an existing dialect
  or a typed client under `app/clients/<provider>/`, and its error codes in
  `app/services/provider_errors.py` (below). The frontend needs zero new
  form code — the add-connection dialog renders from the descriptor's
  `config_fields`, including `boolean` and `select` kinds.
- **Adding or changing a provider means reading its *current* error reference
  and transcribing its codes into `app/services/provider_errors.py`, with the
  source cited.** A provider that publishes nothing falls back to the shared
  status table, and its status meanings still get checked — Pinecone spells the
  status `status`, not `status_code`, and OpenAI answers an exhausted credit
  balance with the same 429 it uses for a rate limit, so an unclassified
  provider gets retried through the full backoff schedule on failures that can
  never succeed and reports congestion for a billing problem. Write the mapping
  from the docs, never from memory: these vocabularies grow, and a stale table
  misfiles the newest failures silently.
- **Retryability is a property of `ProviderErrorCode`, never of the HTTP
  status.** One status carries opposite meanings across providers and even
  within one, so a new retry decision goes in `RETRYABLE_CODES` — a status
  check added anywhere else re-splits the rule and only one half gets updated.
- **A config value that is not a string is rendered for the wire, not
  `str()`-ed.** `ConnectionRead.config` is `dict[str, str]` and the form reads a
  toggle by comparing to `"true"`; Python's `str(True)` is `"True"`, so a naive
  stringification round-trips every enabled capability as *off* and the edit
  dialog offers to disable what is already on.

