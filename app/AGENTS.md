# Backend Engineering Practices

Rules for working in `app/` (FastAPI + Pydantic v2 + SQLModel). Repo-wide rules — the
verify gates, the bug-fix regression-test rule, commit/PR conventions — live in the
root `AGENTS.md` and apply here too; this file covers how backend code is shaped,
added to, and tested.

## The gate

Before finishing any backend change, run `make verify` — typecheck (`mypy app`,
`strict = true`, zero errors), lint (`ruff check app tests` + a slim pylint kept for
the design checks ruff doesn't cover, `--fail-under=10`), then test (`uv run
pytest`). All three must be green. Run `make coverage` separately and review
`term-missing` for untested lines you introduced — `fail_under` in `pyproject.toml`
sits a few points below the last measured percentage so coverage can't silently
collapse. Lowering `fail_under` to make a change pass is not a fix; find out why
coverage dropped.

- **The suite never hits live providers.** OpenRouter/Pinecone/Ollama are stubbed at
  the client boundary; no API credentials are needed to run any test. If live smoke
  tests ever return, they come back as an explicitly opt-in, marker-gated suite with
  its own conftest — never as a credential requirement on the root
  `tests/conftest.py`, which only does environment bootstrapping and the `session`
  fixture, so the suite always collects and runs without secrets.
- **mypy/ruff overrides are for permanent third-party-stub gaps only** (the one
  `[[tool.mypy.overrides]]` entry, `umap`, exists because `umap-learn` ships no
  types and no stub package exists) — never a place to park code you don't want to
  type. Don't add `ignore_errors` for code you're writing today; the same rule
  applies to `[tool.ruff.lint.per-file-ignores]`.
- **Module size: every module under `app/` stays ≤400 lines**, enforced by
  `tests/test_module_size.py` (its `GRANDFATHERED` dict is the single source of
  truth for legacy exceptions, and it's currently empty). Never add an entry for new
  code, and never silence an oversize module with `# pylint: disable=too-many-lines`
  — one of those once defeated the gate for a 1,200-line module. Split the module.

## Layout — where code goes

```
app/
  api/             FastAPI app assembly + dependencies
    routes/        one router module per resource, plus utils.py for shared
                   route-translation helpers (get_collection_or_404, to_http_exception)
  schemas/         Pydantic wire types, one module per domain — the API contract
  clients/         typed external-API clients, one package per provider
                   (openrouter/, pinecone/, ollama/)
  services/        business logic; orchestrates db + clients. errors.py holds the
                   typed domain-error taxonomy. Multi-module concerns split by
                   responsibility (prompts/; the file-tree services files.py,
                   file_deletion.py, file_search.py, file_backfill.py)
  db/              engine.py (process-wide Engine + session_scope/get_session),
                   bootstrap.py, migrations.py, schema.py
    models/        SQLModel tables, one module per domain
    repositories/  data access, one module per domain
  chat/            chat subsystem — service.py facade + flat single-responsibility
                   modules (setup.py, run_loop.py, tools.py, branching.py,
                   persistence.py, streaming.py, parameters.py, …)
  pipelines/       pipeline engine: ports/node/registry/validation/definition,
                   settings.py (registry-driven config extraction), defaults.py,
                   payloads.py, execution/ (runner.py — PipelineRunner), tracing/,
                   nodes/ (one module per pipeline stage + validators.py)
  providers/       model-provider adapters (descriptor + registry + chat/ providers)
  retrieval/       RAG components: chunkers, embedders, parsers, rerankers — one
                   folder per pluggable stage; chunkers/strategies.py holds every
                   concrete chunker and nothing else does
  vectorstores/    vector-database backends behind one interface: base.py (ABC +
                   VectorStoreCapabilities + IndexSpec), registry.py
                   (get_vector_store — single construction/prerequisite gate),
                   pinecone/, pgvector/
  visualization/   embedding-visualization subsystems (umap/ — service + repository)
  core/            settings, auth primitives, cross-cutting config
  utils/           small pure helpers only
tests/             mirrors the app/ layout (tests/api, tests/services, …)
```

New code goes in the existing folder that owns its concern. A new folder is justified
only when it names a genuinely new ownership boundary, not to house one file —
colocate a single file with its consumer.

- **A package folder needs ≥2 cohesive modules; single-file folders collapse into
  their consumer.** A directory holding one module plus `__init__.py` is overhead,
  not a boundary.
- **A subsystem's `__init__` exports its public API only** (`app/chat/__init__.py`
  exports `ChatService`, nothing else); consumers import other names from the owning
  submodule. Re-exporting foreign symbols so a test can monkeypatch through the
  package is forbidden — patch at the real boundary where the name is used
  (e.g. `app.chat.setup.resolve_retrieval_settings`, not a package re-export).
- **`pipelines/nodes/` modules group by pipeline stage, not node count** — a stage
  with several fixed-shape variants shares one base class in its module. Shared
  cross-node validation helpers live in `nodes/validators.py`; a helper used by one
  node stays local. **Validation reads config through the node's config model,
  never the raw config dict** (`SomeConfig.model_validate(node.config or {})`) —
  peeking at `node.config["index_name"]` silently diverges from runtime behavior
  the moment the config model changes.
- **Run lifecycle has one owner: `PipelineRunner`**
  (`pipelines/execution/runner.py`). It wires the `PipelineRun` row, trace
  recorder, executor, and run context for every run; terminal run status is owned
  by `PipelineTraceRecorder`. A caller that must fail a run outside `execute()`
  calls `handle.trace.mark_run_failed(exc)` — never hand-rolls the same
  status/error/completed_at update (that duplication is what `PipelineRunner`
  replaced).
- **Trace summaries preserve complete result identity.** Every item-producing node
  attaches a full ordered `ItemListTrace` for each relevant input/output port,
  including stable ids and scores, alongside its unchanged human-readable preview.
  Never truncate these identity lists or store derived effects: consumers need the
  complete lists to explain filtering, branches, merges, and reordering. A node's
  item list reflects the chunks that node actually emits: the embedding guard
  (`nodes/embedding.py`) may split an oversized chunk into several re-keyed,
  independently-indexed chunks, so its output list legitimately differs from the
  chunker's — the journey shows that split honestly rather than hiding it.
- **Config resolution is registry-driven — hardcoding a node type-id string outside
  the node class that owns it is a lockstep bug.** `pipelines/settings.py` reads
  type ids off node *classes* and walks the registry for interchangeable variants
  (fixed-strategy chunkers), so a newly registered variant is picked up with no
  second place to update.
- **Config values may be expression-tagged (`{"$expr": "top_k * 2"}`) — resolve
  before you `model_validate`.** `PipelineRunner.start` resolves the whole
  definition against the run's variable environment before the run row exists;
  every *static* consumer (settings resolution, validation hooks, tokenizer
  prefetch, embedding-choice extraction) reads configs through
  `resolution.resolve_static_definition` — validating a raw definition's config
  crashes the moment a field holds an expression (that shipped as a
  `resolve_retrieval_settings` crash). Identity fields (backend, index name,
  namespace, dimension, embedder model) carry the `static_only` marker so the
  taint rule keeps them independent of caller input — purge coverage depends on it.
- **The expression grammar lives twice** (`app/pipelines/expressions/` is the
  source of truth; `frontend/src/lib/expressions/` mirrors it for live editor
  feedback), pinned by the shared vectors in `tests/assets/expression_vectors.json`
  that both pytest and vitest execute. A grammar or semantics change lands in both
  implementations plus the vectors, never one side — the vectors are what make the
  drift impossible, so never skip them.
- **One PR ships at most one stored-data migration.** A shape that only ever
  existed on the branch is reworked *inside* the pending migration (hand-fix your
  own dev DB rows), never patched with a second version bump — releases migrate
  release-to-release, and stacked steps for shapes no deployment ever ran are
  permanent startup complexity for nothing.
- **Variadic input ports (`NodePort.accepts_many`) are the fan-in mechanism** — the
  executor collects every inbound edge into a list and the validator rejects
  multiple edges into a non-variadic port (that used to clobber silently). Fusion
  nodes (`BaseFusionNode` + `fuse()` subclasses, `fusion.rrf` today) are built on
  it. **Default pipelines are hybrid** (dense + BM25, fused with RRF), scaffolding
  dense-only when the backend can't serve sparse indexes. **Purges iterate
  `settings.index_targets`** — deletion and re-ingest purges must cover every index
  a pipeline touches. Retriever nodes treat a not-yet-created index as zero matches
  (querying between setup and first ingest never 404s), and the BM25 branch
  degrades to empty with a warning when its name resolves to a dense index.
- **A collection's pipeline is resolved in exactly one place:
  `app/services/pipeline_resolution.py`.** Every caller (ingestion, retrieval,
  chat setup, prompt rendering, deletion purges) goes through
  `resolve_ingestion_pipeline`/`resolve_retrieval_pipeline` rather than repeating
  the ensure-defaults → attach → load → validate → resolve sequence. They raise
  `PipelineResolutionError` (an `InvalidInputError` → 400), never `HTTPException`.
  Tests stub them at the importing module's boundary.
- **One module per domain in `db/models/`.** A new table goes in its domain module.
  `db/models/__init__.py` re-exports every table (plus the `app.schemas.enums`
  aliases) as a permanent flat namespace — importers use `from app.db import
  models`, never reach into a domain submodule from outside the package.

## The dependency direction

`routes → services → db/external clients`, with `schemas` at the edges. Never invert:

- **Settings live in `app/core/config.py`.** Nothing below `app/api` may import
  from `app.api`; the import direction is `core ← schemas ← db/clients ← domain
  packages ← services ← api`.
- **`DEBUG` defaults to `false` — deployments are secure by default.** An unset
  `JWT_SECRET_KEY` is auto-generated on first boot and persisted under the config
  path, so a paste-and-run install signs tokens with a real secret; an explicit
  `changeme` placeholder is rejected unless `DEBUG=true`. Dev entry points opt in
  (`make server`, `tests/conftest.py`). Never flip the default back.
- **`config_path` (small persistent app state) is separate from `storage_path`
  (bulk, reclaimable uploads)** — different Docker volumes, so clearing document
  storage never destroys identity material like the JWT secret. New persistent app
  state (not uploads) goes under `config_path`.
- **Routes are thin — target ≤ ~25 lines: parse → one service call →
  shape/translate.** No business logic, direct SQLModel queries, external API
  calls, or multi-step orchestration in a route. (Pragmatism on the count — a route
  that reads as those three moves is fine; one hiding a fourth is the smell.)
- **Admin-only surface hangs off one router**: `app/api/routes/admin.py`, whose
  router carries `dependencies=[Depends(require_admin)]` — a new admin route is
  gated by construction; never add a per-route admin check elsewhere. Roles are the
  `UserRole` enum. The first registered user becomes admin;
  `ensure_admin_exists` promotes the earliest account on startup for upgraded
  deployments. `AdminUserService` owns the last-admin invariant: demoting or
  deactivating the only remaining active admin is an `InvalidInputError`.
- **Destructive, multi-step operations are services with named steps** (e.g.
  `CollectionDeletionService`'s `_purge_vectors`/`_purge_files`/`_purge_rows`) —
  never inlined in a route, so the sequence and its ordering constraints live in
  one auditable place.
- **Services are where behavior lives**: typed inputs, repositories and clients,
  typed results, domain errors. They must not import from `app.api` — a service
  that needs `HTTPException` is a route in disguise. Subsystem packages (`chat/`,
  `pipelines/`, `providers/`, `retrieval/`, `visualization/`) sit at the same layer
  and follow the same rules.
- **Services raise typed domain errors; a bare `ValueError` is not an API
  contract.** The taxonomy is `app/services/errors.py`: `NotFoundError` (→404),
  `InvalidInputError` (→400), `ExternalServiceError` (→502), all subclassing
  `ServiceError` with a `detail`. Routes translate with `to_http_exception`
  (`app/api/routes/utils.py`) in a single `except ServiceError` — never map status
  by string-matching a message, never leave a domain error untranslated (that's a
  500). Note: chat's missing-session/message cases map to `InvalidInputError`
  (400), not `NotFoundError`, to preserve the wire contract the frontend depends
  on.
- **A genuinely external failure is classified at the service boundary, not left to
  surface raw.** `is_external_provider_error` matches the SDK/HTTP exception
  families the clients actually raise; ingestion/retrieval catch broad `Exception`
  around pipeline execution (to mark the run/document FAILED either way) and
  re-raise as `ExternalServiceError` only when that check matches — an internal bug
  still surfaces as itself, not a misleading "upstream is down".
- **`TraceService` (`app/services/traces.py`) owns trace resolution**;
  `routes/traces.py` only translates `TraceNotFoundError` to 404. Trace read models
  are built via `model_validate(row)` (`from_attributes=True`), not field-by-field
  copying.
- **All query logic lives on a repository (`app/db/repositories/`).** Routes and
  services never build `select()`/`delete()` inline; repositories share
  `base.Repository`, split one-per-domain, re-exported as a permanent flat
  namespace. If two tests in different files assert the same repo behavior, one is
  deleted.
- **Schemas ≠ db models.** `app/schemas/*` are the wire contract; `app/db/models/`
  is persistence. Convert explicitly at the service boundary — returning a db model
  from a route couples the API to the table shape and leaks fields
  (`response_model` is the safety net, not the design).
- **Domain enums live in `app/schemas/enums.py`; `db.models` imports them, never
  the reverse** — the wire contract must not transitively depend on SQLModel. A
  schema needing a db type only for a type hint imports it under
  `if TYPE_CHECKING:`, never as a real top-level import.
- **The engine (`pipelines/`) never defines wire types — `app/schemas/pipelines.py`
  owns the contract and may re-export.** `PipelineDefinition` is the one exception
  (genuinely both engine input and wire shape). Everything else gets its own
  schemas-owned model mapped from the engine type at the route — never a schema
  subclassing an engine class. Routes and services call
  `app.pipelines.registry.default_registry()`; `build_default_registry()` stays for
  tests wanting a fresh instance.

## Adding a feature end-to-end

The expected shape, in order:

1. **Schema** — request/response models in the right `app/schemas/<domain>.py`.
   Contract first; it forces the data-shape conversation before the code one.
2. **DB** — if persistence changes: model in `app/db/models/`, migration in
   `app/db/migrations.py`, repository methods in `app/db/repositories/`.
3. **Service** — the behavior, in `app/services/<domain>.py` or the owning
   subsystem package, typed end to end.
4. **Route** — endpoint in `app/api/routes/<resource>.py` with `response_model`,
   auth via the existing `Depends` helpers, and error translation.
5. **Tests** — service-level for behavior, route-level for the HTTP contract, in
   the mirrored `tests/` folder.
6. If the frontend consumes it, update the hand-mirrored types in
   `frontend/src/lib/types/` in the same PR.

Then run the gate (`make verify`, `make coverage`).

## Adding a config setting

Runtime-editable behavior is a field on `AppConfig` (`app/schemas/app_config.py`),
never a new `Settings` field in `app/core/config.py` — see "Configuration
architecture" in the root `AGENTS.md`.

1. **Field** — add it to the right section model with `Field(default=...,
   json_schema_extra=_meta(label, description, public=..., env_var=...))`.
   `env_var` names a `Settings` field that pins it read-only when set (needs the
   matching `_ENV_PINNED_SETTINGS_ATTR` entry in `app/services/app_config.py`).
   **A field with a finite valid-value domain passes `_meta(..., options=[(value,
   label), ...])`** — that alone turns a `str`/`list[str]` field into a
   `select`/`multi_select` catalog kind (`iter_config_fields` derives the kind from
   the pairing, not a separate control flag) and the admin UI renders a constrained
   picker instead of free text. Add a Pydantic `field_validator` restricting the
   field to the same domain so a PATCH bypassing the UI is rejected too — the
   catalog's `options` and the validator must name the same set, never one
   hardcoded twice. A bounded `int` field needs no separate declaration: its
   catalog `min_value`/`max_value` are read straight off the field's own `ge`/`le`
   constraints (`_numeric_bounds`), so there is exactly one place the bound lives.
   When the valid-value set is itself domain logic (e.g. which MIME types a parser
   supports), put it in its own schema module (`app/schemas/content_types.py`) that
   both the field's default and its `options` import from, not a literal duplicated
   between the two.
2. **Read site** — read through `get_app_config()` at the point of use, never
   `get_settings()`. Never cache the returned `AppConfig` across requests or at
   import time — call fresh each read (it's TTL-cached internally; see pitfalls).
3. **Public wire model** — if the frontend needs it before/without auth, add it to
   `PublicConfig` *and* its mirror in `frontend/src/lib/types/config.ts` in the
   same PR. Fields without `public=True` never reach `PublicConfig` — deliberate,
   not an oversight to "fix".
4. **Test the enforcement red-green** — flip the field via
   `AppSettingRepository.upsert` (or admin PATCH), invalidate the cache, and assert
   the enforcement site's actual behavior (403/400/413/…), not just that
   `effective_config()` returns the value.

The admin settings page renders from the config catalog, so a new field needs no
frontend form code — only a new `ConfigFieldKind` would.

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
  Dockerized ParadeDB DB — `make test`/`make coverage` start it for you
  (`docker-compose.dev.yml`, loopback-only port 54329); it ships the `pg_search`
  the release image runs.** On a Postgres without `pg_search` (e.g. a bare
  external `TEST_DATABASE_URL` override) the BM25 path is untested —
  `pg_search_session` tests skip with a named reason — so a green run there is
  not proof a sparse/hybrid change works; verify against the ParadeDB dev DB.
  Dependent tests use the `pgvector_session`/`pg_search_session` fixtures.
- **The lexical (BM25) plane mirrors the dense one, backend-natively.**
  `upsert_lexical`/`lexical_query` serve sparse indexes
  (`IndexSpec(vector_type="sparse")`): pgvector via ParadeDB pg_search BM25 over
  `lex_<name>` tables; Pinecone always creates sparse indexes with the integrated
  `pinecone-sparse-english-v0` model so raw-text upserts/searches work (a sparse
  index without integrated embedding can't be text-searched; text upserts cap at
  96/batch). A pipeline's sparse index is named `<dense>-bm25`
  (`bm25_sibling_index_name`, truncated to the shared 45-char rule).
- **Node type ids are permanent.** Persisted definitions reference
  `indexer.pgvector` etc. by string; a new backend adds ids, never renames. The one
  recorded exception (`embedder.openrouter` → `embedder.text`) shipped with a
  startup data migration (`app/services/provider_migration.py`) that rewrote every
  stored definition — never retire an id without the same full-rewrite migration.
- **Per-document vector deletion goes through `delete_document_vectors`** (chunk
  vector ids are `{document_id}:{order}`). Never delete a whole namespace to remove
  one file.

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
- **Adding a provider type is a checklist**: config model in
  `app/schemas/providers.py`, `ProviderType` enum value, adapter module with its
  descriptor, `ADAPTERS` registry entry, typed client under
  `app/clients/<provider>/`. The frontend needs zero new form code — the
  add-connection dialog renders from the descriptor's `config_fields`.

## The collection file tree (`file_nodes` + `documents`)

- **A `FileNode` is identity and hierarchy; a `Document` is the ingestion record.**
  Files exist regardless of ingestion: no document row = not pipeline-eligible;
  `failed` always carries `error_message`; `ready` always means indexed chunks.
  Never create a state that reads as "ingested with zero chunks".
- **Uploads always persist; eligibility only gates auto-ingestion.**
  `uploads.allowed_content_types` is the auto-ingest list, not an upload gate;
  `POST /api/files/{id}/ingest` force-attempts regardless — the parser's own error
  is the honest outcome.
- **Background ingestion opens its own `session_scope`** (`run_document_ingestion`)
  — a background task runs after the request session is gone. It never re-raises:
  the FAILED document row *is* the outcome; the wrapper only logs.
- **Stored bytes are keyed by node id** (`collections/{cid}/files/{node_id}`), so
  rename/move never touches disk. Sibling-name uniqueness is enforced in
  `FileSystemService` (Postgres unique indexes treat NULL `parent_id` as distinct,
  so a DB constraint can't cover root siblings).
- **The `?parent_id` listing + `FileSystemService.resolve_path` are the
  model-navigation surface** (`ls`/`cd` semantics for future chat tools) — keep
  their shapes stable; extend rather than fork.

## Hooking into telemetry

Telemetry (`app/telemetry/`) records lightweight, aggregatable activity facts to the
local `telemetry_events` table for admin dashboards; nothing is ever sent
externally. Its one invariant: **recording never breaks the feature being
recorded** — `record()` opens its own short `session_scope()` (never the request
session) and swallows any failure with a logged warning, a deliberate documented
exception to the never-swallow rule, scoped to that module.

1. **Event model** — a Pydantic model in `app/telemetry/events.py` with a unique
   dotted `type` literal, added to the `TelemetryEvent` union; payloads are
   aggregatable scalars, not blobs.
2. **Hook** — call `record(...)` at the service-layer site where the fact becomes
   true, *after* the owning transaction commits (telemetry observes outcomes, never
   participates). Never hook in a route — the one exception is login, which has no
   service.
3. **Aggregation** — only if a dashboard consumes it, add a `TelemetryRepository`
   query method; dashboards never query the table directly.
4. **Test** — drive the real entry point and assert the row landed
   (`tests/telemetry/test_instrumentation.py` is the pattern); the recorder's own
   behavior is already pinned in `test_recorder.py` — don't re-test it per event.

Boundary rule: heavyweight operational records that power features stay domain
tables (`QueryEvent`/`IngestionEvent` feed the trace UI); telemetry rows are the
aggregatable facts beside them — retrieval deliberately writes both. One table for
all event types, on purpose: adding an event never needs a migration.
`telemetry.enabled` and `telemetry.retention_days` are AppConfig fields.

## Logging (`app/observability/`)

Structured operational logging for diagnosing failures — connect a failure to a
request, a user, and an operation — without recording user content or secrets.
Full policy and the field contract live in `docs/observability.md`; the rules
that must hold in code:

- **All logging goes through `app/observability/`** — `get_logger(__name__)` and
  named events. Never a feature-local formatter, logger config, request-ID
  generator, or redaction implementation; a second one silently diverges from the
  shared contract and its redaction.
- **JSON to stdout only.** No application-managed log files, rotation, retention,
  or shipping — the runtime operator owns collection (12-factor). Adding a log
  file is the anti-pattern this rule exists to stop.
- **Event names are stable dotted `domain.action[.outcome]` facts; identifiers
  are structured fields, never interpolated into the message string** — a
  message like `f"ingested {doc_id}"` is unqueryable and un-redactable. The
  canonical names are in `events.py` and pinned by
  `tests/assets/observability_contract.json` (asserted by pytest *and* vitest —
  a rename lands on both sides or fails the gate).
- **`user_id` is the internal UUID, unhashed** (opaque operational metadata the
  operator joins to the DB), on authenticated request-completion events and
  user-owned background work; omitted for unauthenticated/health/infra events.
  Read it from `request.state.user_id` in the middleware, never a context var:
  sync routes run in a threadpool whose context-var writes don't reach the
  middleware, but `scope["state"]` is shared.
- **Never log** email/username, passwords, API keys, auth headers, JWTs,
  cookies, session IDs, connection strings, request/response bodies, file
  paths/names, document/chunk text, prompts, chat messages, search queries, or
  raw provider payloads. `redaction.py` is the safety net (denylisted keys →
  `[REDACTED]`, control-char stripping, truncation), not a licence to pass these.
- **Sanitize untrusted values before emitting** (log injection) and **`DEBUG`
  never relaxes redaction** — it may add diagnostic metadata and switch to the
  console renderer, nothing more.
- **The request middleware and diagnostics ring buffer are process-lifetime and
  restart-scoped by design** — the durable history is stdout. The admin export
  (`GET /api/admin/diagnostics/export`) serves the buffer; it can never contain
  anything stdout couldn't, because the buffer tee runs *after* redaction.
- **The buffer tee strips `ProcessorFormatter` meta keys (`_record`,
  `_from_structlog`) before storing.** A *foreign* stdlib record (uvicorn,
  SQLAlchemy, any un-migrated `logging.getLogger`) arrives at the shared
  pre-chain with a raw `logging.LogRecord` seeded under `_record`;
  `remove_processors_meta` drops it in the render chain, which runs *after* the
  tee. Keeping it makes the export 500 serializing a `LogRecord`. A test that
  only buffers structlog-*native* calls never sees this — exercise a foreign
  record.

## Collection diagnostics (`app/services/diagnostics/`)

Cross-pipeline compatibility findings served from `GET /api/collections/{id}/
diagnostics` (see `docs/diagnostics.md`). The invariants:

- **A finding is always a `CollectionDiagnostic` from a registered rule** — never a
  one-off warning string. A rule declares a stable `code` + `category` and an
  `evaluate(ctx) -> list[CollectionDiagnostic]`; adding a check is one rule class +
  one `registry.py` line + tests, no schema change and no frontend form code.
- **A rule degrades, never sinks the endpoint.** `CollectionDiagnosticsService`
  wraps each `evaluate` so a throwing rule becomes one `info` finding and the rest
  still run; live-probe rules catch their own store failures and emit an
  "unavailable" `info` finding. The endpoint must always return 200 with a response.
- **The context resolves both pipeline sides read-only** (`resolve_*_pipeline(...,
  scaffold=False)`) and reads settings through `ctx.ingestion_settings` /
  `ctx.retrieval_settings` — never a raw node-config dict, never a re-resolve. A GET
  that scaffolded/bound a default pipeline would mutate state on every Overview
  visit; `scaffold=False` is why it can't.
- **`consistent` deliberately ignores `run_failures` and `node_config`** — it claims
  the current *configuration* is sound, not that nothing is noteworthy. Keep the
  Overview copy ("Configuration consistent") honest about that.
- **The `VectorStoreProber` shares one time budget per request**, not per-probe
  timeouts that stack — a hybrid default probes two index targets on a cold-cache
  Overview visit, and a slow store must not stack full timeouts before the card
  renders.

## Fixing a bug

Follow the root rule: regression test in the same commit, verified red-green.
Reproduce at the lowest layer that exhibits the bug (pure function > service >
route) and watch it fail for the bug's reason — not an import error or fixture
typo. If the bug teaches a durable rule, add one line to the relevant section of
this file in the same PR.

## Code quality standards

- **A gate never iterates a whole enum** (`all(coverage[k] for k in ProviderKind)`)
  — enumerate the members it actually requires. Adding an enum member silently
  strengthens every whole-enum gate: adding `RERANKING` once trapped users in the
  setup wizard on every page load.
- **Strong typing everywhere.** No `Any` as an escape hatch; no `isinstance`
  ladders in place of a schema or discriminated union. Python ≥3.11 house style:
  `X | None`, `list[X]`, `dict[K, V]` — not `Optional`/`List` (ruff `UP` flags
  them). The one legitimate `Any` fills a generic parameter that genuinely has no
  narrower type (SQLAlchemy `Column[Any]`, numpy `ndarray[Any, ...]`, a provider
  payload dict whose key set is genuinely open-ended) — never `Any` in place of a
  type you could write down.
- **`cast()` is never the fix for an `Optional`.** It hides the crash at the
  assignment and detonates downstream (a shipped `cast(str, call_id)` masked a
  provider tool call with no id until it blew up inside `ToolCallTrace`). Handle
  the `None`: fallback, raise, or narrow with a real check.
- **Validate at the boundary, trust inside.** Pydantic validates at the route;
  internal code assumes valid data. Re-validating mid-stack is noise; failing to
  validate at the edge means garbage crashes far from its source.
- **A defensive raw-dict fallback beside a Pydantic schema means the schema is
  wrong or the fallback is dead** — fix the schema, delete the fallback, let
  `ValidationError` surface. Exception: a field genuinely typed `Any` still needs a
  real check at first use — that's doing the validation the schema couldn't.
  **Protocol stub bodies are `...`, never `return None`** — a stub returning a real
  value reads as a default implementation and invites subclasses to rely on it.
- **Data-oriented design: model the data first.** Most backend bugs here are shape
  bugs. Any dict crossing a function boundary with a stable key set is a Pydantic
  model (message/event/usage dicts were the bug farm — see `app/chat/events.py`,
  `messages.py`, `usage.py`); discriminated unions for variants; hand-rolled
  coercion functions are Pydantic validators in disguise. Corollary: a genuinely
  open-ended provider-defined dict is *not* a stable key set — model the known
  aggregate separately and let the raw payload pass through.
- **OO where there's state, functions where there isn't.** Classes earn their
  existence by owning a resource or invariant; stateless logic is a module-level
  function — don't wrap it in a class for ceremony.
- **Small files, one responsibility.** A module you can't summarize in one sentence
  is two modules. Split before it becomes a grab bag.
- **Don't abstract on the first occurrence — or reflexively on the second.**
  Duplication is cheaper than the wrong abstraction. Extract on the third use, or
  when two copies must change in lockstep (that's a latent bug, not duplication).
  Never add a parameter, base class, or hook for a caller that doesn't exist yet.
- **A streaming and non-streaming variant of the same operation share one
  implementation** — the variant is a parameter, or the caller drains the iterator.
  The chat send/stream paths once drifted (two hand-synced loops and constants) so
  a change to one silently skipped the other; the single loop lives in
  `app/chat/run_loop.py` (parameterized by `stream`) and the single tool path in
  `app/chat/tools.py::ToolExecutor.execute`.
- **Docstrings on modules, classes, and functions** — contract and intent, not a
  restated signature. Comments explain *why* for non-obvious behavior only.
- **Pylint-clean.** A `# pylint: disable=` needs an adjacent comment saying why,
  and is never the fix for a design problem.
- **Dead code is deleted on sight** — including whole dead layers, not just
  symbols: an unexecuted parallel implementation drifts silently from the one
  actually running, and its tests only assert that it agrees with itself. Grep for
  callers before deleting and report the grep either way.
- **Import-time side effects are forbidden**, with one deliberate exception: the
  process-wide db `engine` (`app/db/engine.py`). Every other setup step lives in a
  function called from `main.py`'s `lifespan`, so importing a module for its types
  never has side effects.

## FastAPI / Pydantic pitfalls (this stack, specifically)

- **Sync by default, `async def` only when you mean it.** Sync `def` routes
  (threadpool) with a sync `Session` and `httpx.Client`. The unforgivable mix: an
  `async def` route making a blocking call — it stalls the whole event loop, and no
  test catches it because it "works" under zero concurrency. If an endpoint must be
  async (streaming, `routes/chat.py`), everything it awaits must be genuinely
  async.
- **No mutable default arguments, and no `Depends()` results stored globally** —
  both are share-state-across-requests bugs. Request-scoped state comes from
  dependencies; process-scoped clients are created once at startup, deliberately.
- **Pydantic v2 semantics.** `model_validate`/`model_dump`, not v1
  `.dict()`/`.parse_obj()`; `model_dump(mode="json")` for JSON-safe primitives; a
  mutable field default needs `default_factory`.
- **SQLModel `table=True` models skip validation on construction** — another reason
  schemas and db models stay separate.
- **Enum-typed columns on DB-loaded rows are raw strings — compare with `==`,
  never `is`.** `binding.role is BindingRole.INGEST` silently fails on any row
  the session loaded from Postgres (str-enum equality still holds); identity
  checks against enum members only work for in-memory constructions.
- **Sessions have one owner.** Request-scoped sessions come from `get_session`;
  don't open ad-hoc sessions inside services that already received one, and don't
  let a session escape its request (detached-instance errors show up far from
  their cause).
- **Never mutate a JSON column in place** (`model.extra_metadata[key] = value`):
  our JSON columns aren't `MutableDict`-wrapped, so the session never sees the
  change and **nothing is written** — the response still looks right because it's
  the same in-memory object. Reassign a new dict or call `flag_modified`. We
  shipped exactly this bug in `update_collection_prompt`; its test passed for
  months via object identity.
- **Streaming responses outlive the request handler.** A `StreamingResponse`
  generator runs after the function returns — anything it closes over must still be
  alive, and cleanup must handle mid-stream disconnects.
- **Persist partial stream content on *any* mid-stream termination, not just
  `GeneratorExit`.** The chat run loop once caught only client-disconnect and lost
  streamed content when the provider raised mid-turn. The handler wraps
  `(GeneratorExit, Exception)` around the token-streaming step only (the tool-call
  message is already committed — wider scope would double-persist), records the
  partial, and re-raises so the route still emits an `error` SSE event. Never
  swallow.
- **Resolve a client-supplied `session_id` against the current user, and reject one
  owned by another user as a domain error** (`InvalidInputError`, "Chat session not
  found") rather than creating a row under a colliding primary key — that surfaced
  as an opaque `IntegrityError`/500 and is a cross-user access attempt.
- **External-API code lives in `app/clients/<provider>/`, typed end to end.** A
  client method returning `dict` is a bug, not a shortcut; timeouts set explicitly.
  Split same-package modules (e.g. `catalog.py`) for shaping logic that does no
  I/O, taking the transport as injected callables. Before changing these
  integrations, read the local `docs/external-api/` docs first — behavior there
  trumps memory.
- **Never send OpenRouter an explicit embeddings `dimensions` unless the user asked
  for one** — most embedding models reject the parameter outright. Set only
  `model_name` and let the model emit its native dimension; the indexer node alone
  carries `dimension` (for index creation/validation). When the embeddings envelope
  carries an `error` instead of `data`, raise `ExternalServiceError` with the
  provider's message (502), never a bare `ValueError` (500).
- **Never rely on prompt wording to get machine-readable model output.** When a
  chat call's reply is parsed by code (JSON, scores, labels), enforce the shape
  with the inference feature built for it — structured outputs
  (`response_format` with a strict JSON schema) or forced tool calling — and
  surface only models that advertise support (`supported_parameters`) in any UI
  picker for that task; "reply with JSON only" prompts silently degrade into
  parse-and-discard churn on models that add prose or fences. A tolerant parser
  may remain as a safety net for providers that ignore the parameter, never as
  the primary contract.
- **A stream parser is written against captured wire frames, not assumed shapes**
  — Cohere's v2 SSE stream ends with a bare `data: [DONE]` sentinel and its chat
  API 400s on an empty assistant history entry; both shipped as live-only bugs
  because the mocked fixtures encoded the shape we expected instead of a
  captured stream tail.
- **Never feature-detect a pinned SDK with `inspect.signature`.** A runtime probe
  of Pinecone's `create_index` was always-false dead code on the version actually
  pinned, silently no-opping a config field. Introspect the *installed* SDK while
  writing the client, then call it directly — the lockfile guarantees the version.
- **Never `lru_cache` objects that own OS resources** (httpx clients, sessions,
  file handles): eviction drops the reference and whatever it owns leaks (we had
  this on `get_openrouter_client`). Use an explicit cache that closes what it
  evicts, and never key a long-lived cache on a raw secret you can't invalidate.
- **`get_app_config()` is TTL-cached (30s) at module scope.** A test that mutates a
  DB override and asserts on the new value must call
  `invalidate_app_config_cache()` after the write, or it reads stale config. The
  config-related test modules carry an autouse fixture that invalidates on setup
  *and* teardown (the module-level cache otherwise leaks into whichever test runs
  next) — copy that pattern.
- **Import-time `settings = get_settings()` snapshots are forbidden.** A
  module-level snapshot never sees a later settings change (env override,
  `cache_clear()` in a test). Call `get_settings()` at the point of use — in a
  function body or a `default_factory` — so the read happens at call time. The two
  documented exceptions are `app/db/engine.py` (the process-wide engine) and
  `app/api/main.py`'s app assembly (uvicorn imports `app` directly; middleware
  needs settings at module scope). Every other module-level snapshot is the bug
  this rule catches.

## Wire-contract completeness

When a route shapes a response from a richer internal result, every schema field
must be populated from the result — a field left to its default (`warnings=[]`) is
invisible data loss the schema can't catch. When adding a field to a response
schema, grep every construction site.

## Testing philosophy

- **Test behavior, not wiring.** A test earns its place by failing when a real
  contract breaks. "The route calls the service" (asserted via mock) is wiring —
  delete it. The tell: if you deleted the code under test and the test still passed
  (or only a rename could break it), it was never testing behavior.
- **Test at the lowest layer a real bug would appear.** Pure logic as unit tests;
  orchestration at the service layer; route tests reserved for the HTTP contract —
  status codes, validation rejections, auth gating, response shape.
- **Route tests go through `TestClient`, not a direct function call.** Calling the
  route function with hand-built `current_user`/`session` kwargs exercises none of
  the HTTP layer (auth, 422 validation, serialization, ownership isolation) — that's
  a service test in disguise. Use the `client`/`unauthed_client` fixtures
  (`tests/api/conftest.py`). The high-value contracts, swept resource-agnostically
  in `tests/api/test_route_contract.py`: 401 without a token, cross-user 404 on
  get/update/delete (the costliest bug class), 422 on a malformed create body, and
  responses that never serialize a secret.
- **Realistic scenarios over synthetic ones.** Fixtures look like real data
  (`tests/assets/`); the valuable cases are the awkward ones — empty collections,
  unicode documents, a provider erroring mid-stream — not the third happy-path
  permutation.
- **Exercise failure paths as deliberately as the happy path, especially at a
  provider boundary.** A provider-facing service has two contracts: success, and
  what a caller sees when the provider is down/rate-limited/rejecting credentials.
  Boundary-stub the real SDK exception and assert the *typed* outcome
  (`ExternalServiceError` → 502, or the streaming `ErrorEvent`) — the failure path
  is the contract worth pinning.
- **Mock at the boundary you don't own.** Fake OpenRouter/Pinecone/Ollama at the
  client edge; never mock your own services to test your own routes — that pins
  implementation and proves nothing.
- **Tests that construct objects via `__new__` and monkeypatch private methods pin
  layout, not behavior — delete them on refactors, don't migrate them.** Drive the
  public entry point against a real session with the boundary stubbed
  (`test_chat_service_flow.py` is the harness) so the test survives the next
  reshuffle. Same for reload-the-module-to-observe-an-import-time-effect tests: if
  a test needs machinery like that, the behavior is in the wrong shape, not the
  test.
- **A test that must be updated whenever anything changes is measuring layout —
  delete it.** Meaningfully lower coverage from deleting mock-echo tests beats a
  suite padded with tests that assert nothing and break on every refactor.
- **Persistence assertions must read back through a fresh session**
  (`with Session(session.get_bind()) as fresh:`). Asserting on the object the code
  just handled proves nothing — the identity map hands back the same in-memory
  instance, so the test passes even when nothing was written (this is exactly how
  the JSON-mutation bug survived). And always close that fresh session — an
  unclosed one sits idle-in-transaction and deadlocks the next test's
  `DROP SCHEMA` reset, hanging the suite.
- **Coverage is a floor, not a goal; an untested line needs a stated reason, not
  silence.** Legitimate named reasons: a thin third-party-SDK wrapper where the
  test would only re-assert the mock; orchestration glue already exercised against
  real Postgres by other tests; a defensive branch with no live path to force
  cheaply. Say so in the PR rather than writing a can't-fail test.
- **Never write tests that execute Protocol/ABC stub bodies or assert
  `NotImplementedError` on abstract methods** — they assert nothing and rot
  silently when signatures change.
- **All patching goes through `monkeypatch`.** A bare module-attribute assignment
  outlives its test and poisons whatever runs next, order-dependently. And never
  build fakes with `SimpleNamespace(__str__=lambda: ...)`: dunder lookup happens on
  the type, so the fake passes for a reason unrelated to the behavior it claims to
  check.
