# Backend Engineering Practices

Rules for working in `app/` (FastAPI + Pydantic v2 + SQLModel). Repo-wide rules — the
verify gates, the bug-fix regression-test rule, commit/PR conventions — live in the
root `AGENTS.md` and apply here too; this file covers how backend code is shaped,
added to, and tested.

## The gate

Before declaring any backend change done, run `make verify` — typecheck (`mypy app`,
`strict = true`, zero errors), lint (`ruff check app tests sandbox` — including
the PLR09xx design budgets that replaced pylint), then test (`uv run pytest --cov`).
All three must be green — the test stage carries coverage, so the suite runs
once. Review `term-missing` for untested lines you introduced; lowering
`fail_under` to make a change pass is not a fix, find out why coverage dropped.
This is the *full* gate — run it once when the work is done, not
per edit; the per-edit fast tier (ruff + mypy + the touched area's tests with
`-n 0`) lives in the root `AGENTS.md`. The suite is parallel by default
(pytest-xdist, per-worker template-copied databases); pass `-n 0` for a quick
single-file run so worker startup doesn't dominate.

- **The suite never hits live providers.** OpenRouter/Pinecone/Ollama are stubbed at
  the client boundary; no API credentials are needed to run any test. If live smoke
  tests ever return, they come back as an explicitly opt-in, marker-gated suite with
  its own conftest — never as a credential requirement on the root
  `tests/conftest.py`, which only does environment bootstrapping and the `session`
  fixture, so the suite always collects and runs without secrets.
- **mypy/ruff overrides are for permanent third-party-stub gaps only** (the
  `[[tool.mypy.overrides]]` entries — `pacmap`, `sklearn.*`, `numba` — exist
  because those packages ship no types and no stub packages exist) — never a
  place to park code you don't want to type. Don't add `ignore_errors` for code
  you're writing today; the same rule applies to
  `[tool.ruff.lint.per-file-ignores]`.
- **Module size: every module under `app/` stays ≤400 lines**, enforced by
  `tests/test_module_size.py` (its `GRANDFATHERED` dict is the single source of
  truth for legacy exceptions, and it's currently empty). Never add an entry for new
  code, and never silence the gate with a suppression — split the module.

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
  visualization/   collection-insight subsystem (insights/ — spaces, engine,
                   builder, incremental, service, probe, tasks, projection_worker)
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
- **Ports are typed by data shape, never by pipeline stage.** The unified `items`
  kind carries every list-of-items stream (chunks, the query, matches) and what a
  stream guarantees about its items is a facet set (`text`/`embedding`/`score`):
  inputs declare `requires`, outputs declare `adds`/`preserves`, and compatibility
  is inferred through the whole graph (`app/pipelines/facets.py`) — a stage-named
  port type forces dual-mode nodes (an embedder with chunk and query ports) and
  blocks sound graphs like re-embedding a result set. The inference is mirrored in
  `frontend/src/components/pipelines/lib/facet-inference.ts` and pinned by the
  shared vectors in `tests/assets/facet_vectors.json` (pytest + vitest) — a
  semantics change lands in both implementations plus the vectors, never one side.
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
- **Overlap is *added* to `chunk_size`, so `chunk_size + overlap` is what the
  embedder receives and what every limit bounds.** `chunk_size` is the new
  document text per chunk and the stride between chunks; a chunk spans
  `chunk_size + overlap` tokens. Bounding `chunk_size` alone lets a configured
  window overflow the model's input limit, and the embedding guard then splits
  chunks the author sized deliberately. Bound the sum (`clamp_chunk_window`);
  on shrink, scale both parts so the sum lands on the limit and the overlap
  ratio survives. The guard in `nodes/embedding.py` must likewise pass
  `chunk_size = limit - overlap`, or it emits parts over the limit it enforces.
  `overlap` is *not* bounded by `chunk_size` — above it a chunk repeats more
  than it advances, which is wasteful but well-defined, so the editor warns
  rather than the chunker refusing. This deliberately differs from
  LangChain/LlamaIndex, where `chunk_size` is the whole window.
- **A constraint one node imposes on another is checked from the node that owns
  it, and reported on the field that fixes it.** The embedding input limit
  belongs to the embedder, but `chunk_size` is what a user changes, so
  `app/pipelines/embedding_limits.py` walks chunks forward and addresses its
  finding to the chunker while naming the model. Chunks are followed
  transitively along `items` edges, continuing only through *preserving*
  outputs, not across one edge: adding a node that forwards items must not
  silently switch the check off, while a node emitting new items (a
  retriever) honestly ends the chunker's reach. A chunker fanning out to several
  embedders yields **one** finding bound by the smallest limit — the editor
  renders a single issue per field, so several would hide each other and could
  leave the least restrictive one showing.
- **PaCMAP runs only in the projection subprocess
  (`app/visualization/insights/projection_worker.py`), never in the app
  process.** pacmap's faiss+numba OpenMP runtimes clash with the sklearn this
  process loads, in platform-dependent init orders that segfault or deadlock —
  an in-process call works on one machine and kills the worker on another. The
  child module stays import-light (numpy only at module level) and warms numba
  before pacmap is even imported; `insights/__init__` stays lazy for the same
  reason.
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
  crashes the moment a field holds an expression. Identity fields (backend, index name,
  namespace, dimension, embedder model) carry the `static_only` marker so the
  taint rule keeps them independent of caller input — purge coverage depends on it.
- **A config field may read its siblings as `self.<field>`, and `self` is a
  reserved variable name.** Reserving it is what makes shadowing impossible:
  adding a pipeline variable can never change what an existing node computes.
  Resolution orders a node's fields by their dependency graph
  (`app/pipelines/node_scope.py`), never by config key order — key order is a
  serialization artifact, so a definition round-tripped through a different
  JSON writer would otherwise resolve to different values. Absent siblings are
  seeded from the node's own `default_config`, so reading an unset field gives
  the value the node will actually run with rather than a run-time error.
  Cycles raise instead of recursing.
- **Taint follows `self.` chains.** An identity (`static_only`) field reading a
  sibling that reads caller input is exactly as request-dependent as reading
  the input directly, and a per-request index name returns nothing rather than
  failing — nothing downstream would ever surface it.
  `validation_node_config.tainted_config_fields` closes over the chain.
- **A field whose natural value is a formula over its siblings declares it as
  `expr_seed`** (`Field(json_schema_extra=expr_seed_extra(...))`), so the
  editor's ƒx toggle starts from that formula. The knowledge lives on the node;
  the frontend reads it off the config schema and needs no per-node code.
- **The expression grammar lives twice** (`app/pipelines/expressions/` is the
  source of truth; `frontend/src/lib/expressions/` mirrors it for live editor
  feedback), pinned by the shared vectors in `tests/assets/expression_vectors.json`
  that both pytest and vitest execute. A grammar or semantics change lands in both
  implementations plus the vectors, never one side — the vectors are what make the
  drift impossible, so never skip them.
- **Binding values and the collection built-ins (`collection_id`,
  `collection_name`, `user_id`) are untainted by design.** Both are fixed when a
  pipeline is bound to a collection rather than supplied per request, so an
  identity field may derive an index name from them and still resolve to one
  deterministic index per binding — which is exactly what purge coverage needs.
  Adding them to `tainted` would reject every index name a collection computes.
- **The validator's type environment must carry every built-in the runtime
  environment carries** (`_static_types` in `validation_variables.py`). A built-in
  present at run time but missing from validation makes every expression over it
  "unknown variable", and the fallback then *strips* the identity field it fed —
  turning a valid pipeline into one with no index.
- **One PR ships at most one stored-data migration.** A shape that only ever
  existed on the branch is reworked *inside* the pending migration (hand-fix your
  own dev DB rows), never patched with a second version bump — releases migrate
  release-to-release, and stacked steps for shapes no deployment ever ran are
  permanent startup complexity for nothing.
- **A migration that rewrites a shape the schema can no longer parse runs
  before every migration that parses.** The order lives in one place,
  `app/services/startup_migrations.py`. Removing a value from an enum (a
  `VariableSource`, a node type id) makes every stored row still holding it
  unparseable, so a step doing `PipelineDefinition.model_validate(raw)` raises
  in `lifespan` and the process dies before the migration that would have
  fixed that row ever runs — the app never boots, retrying never helps, and
  the suite stays green because it builds every row from the current schema.
  Such a migration works on raw stored JSON for the same reason; say so in its
  docstring.
- **Startup migration only *adds* columns, so deleting a model field leaves a
  stale `NOT NULL` column that rejects every later insert.** `create_all` +
  `apply_missing_columns` never drop anything, and the failure is a runtime
  `NotNullViolation` on write — invisible to the suite, which builds the schema
  fresh from the current model. After removing a field, drop the column by hand
  in every database that already ran the old model (a branch-only table) or ship
  a real drop step (a released one) — otherwise the tests stay green while every
  insert against an existing DB returns a 500.
- **`index_targets` lists every dense store the graph touches, not the primary
  one.** Purges iterate it (`app/pipelines/index_targets.py`), so a graph
  splitting its corpus across two indexes keeps the second one's vectors through
  every delete and re-serves removed documents on the next query. The scalar
  `backend`/`index_name` settings still describe the primary store.
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

Then run the gate (`make verify`).

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

## LLM pipeline nodes (`app/pipelines/llm/` + `nodes/llm_*.py`)

- **The `llm.*` nodes are thin facet shells over one engine; a new LLM method
  ships as a `NodePreset` (seeded config), never a new node type id.** Type
  ids are permanent wire contract; a preset is data — HyDE, contextual
  retrieval, and query expansion are prompts + output fields on an existing
  shell, and a per-method type would re-implement the same node under a name
  that can never be retired.
- **LLM-call throttling is connection-scoped, enforced by the engine's
  process-wide registry (`llm/throttle.py`) — never a per-node knob.** The
  connection is the thing being rate-limited; two nodes with their own
  budgets would unknowingly double-hit one server. Both settings live on the
  connection config (`max_concurrent_requests`, `requests_per_minute`) with
  starter-tier defaults on the adapters; RPM pacing runs inside a held
  concurrency slot so a full window never parks unbounded threads, and a
  `None` RPM default means unpaced (local servers, providers with no
  router-side cap) with 429 backoff as the reactive floor.
  `stamp_llm_throttle_defaults` writes the defaults onto existing chat
  connection rows at startup — key-presence idempotent, so a user's edit is
  never overwritten.
- **The engine's failure policy is classified by run kind
  (`context.document`): ingestion runs are strict, query-time runs degrade
  per item with a warning recorded in the trace.** A corpus where some
  chunks silently lack their transformation is an invisible quality bug; at
  query time a live answer beats an error, and the trace tells the truth.
  Only provider faults and output-shape misses degrade — our own bugs
  surface as themselves.
- **A new `NodeTraceValue` kind lands in the wire mirror
  (`app/schemas/traces.py` + `frontend/src/lib/types/traces.ts`) in the same
  change.** The read model pins a `Literal`, so a kind it has never heard of
  makes every trace containing it fail to parse — the whole trace endpoint
  404s, not just the new value.
- **Metadata-filter values name pipeline variables via the schema's own
  `var` field, resolved at run time (`app/pipelines/filtering.py`) — never a
  nested `$expr`.** Expression resolution walks top-level config keys only,
  so an expression tag inside the filter structure would ship to the store
  unresolved and match nothing.

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
  proves nothing for a sparse/hybrid change (the root `AGENTS.md` dev-database
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
  `indexer.pgvector` etc. by string; a new backend adds ids, never renames. The one
  recorded exception (`embedder.openrouter` → `embedder.text`) shipped with a
  startup data migration (`app/services/provider_migration.py`) that rewrote every
  stored definition — never retire an id without the same full-rewrite migration.
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
  straight in Postgres (or before the column existed) is still adoptable rather
  than silently missing from a live collection's registry.
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
- **There is no per-collection variable source.** A variable a binding
  overrode meant the definition no longer described what it did — you needed
  the pipeline *and* the collection running it — and for an index the cost of
  getting it wrong is invisible, because retrieval returns nothing rather than
  failing. A binding says *which* pipeline runs and in what role, never what
  it does. Input variables are a different thing: they are the tool's public
  contract, vary per call, and never move where data lives. A pipeline that
  must differ per collection is a different pipeline — `copy_pipeline` is how
  you get one.
- **A user's collections are separated inside one index by `namespace`, not by
  having their own index.** One pipeline already serves every collection that
  user owns without interference, which is why per-collection index choice buys
  so little: it covers only collections on *different* stores, and charges every
  collection an infrastructure decision to do it. This is a
  claim about one account's collections and says nothing about accounts: on a
  shared backend a name is one physical store for the whole deployment, so a
  default that hands two accounts the same name interleaves their vectors where
  neither can see the other — which is why index names offered to a user are
  derived per account.
- **Backend compatibility is a property of the graph, and the error names the
  nodes.** Since an index carries its backend, a graph could once be valid as
  authored and invalid for one
  collection — no: since a node names its own index, that is a property of the
  definition and is checked when the pipeline is *saved*.
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
  look text-only and hides the vision models a filter exists to find. Each
  adapter reads its provider's own positive statement — OpenRouter's
  `architecture` block, Ollama's `/api/show` capabilities, Anthropic's
  published `capabilities.image_input` — and a provider that publishes nothing
  claims nothing beyond text rather than guessing.
- **Adding a provider type is a checklist**: config model in
  `app/schemas/provider_configs.py`, `ProviderType` enum value, adapter module
  with its descriptor, `ADAPTERS` registry entry, and either an existing dialect
  or a typed client under `app/clients/<provider>/`. The frontend needs zero new
  form code — the add-connection dialog renders from the descriptor's
  `config_fields`, including `boolean` and `select` kinds.
- **A config value that is not a string is rendered for the wire, not
  `str()`-ed.** `ConnectionRead.config` is `dict[str, str]` and the form reads a
  toggle by comparing to `"true"`; Python's `str(True)` is `"True"`, so a naive
  stringification round-trips every enabled capability as *off* and the edit
  dialog offers to disable what is already on.

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
  model-navigation surface** (`ls`/`cd` semantics for chat and MCP file tools) —
  keep their shapes stable; extend rather than fork.
- **File deletion races in-flight ingestion, and deletion must win.** The
  ingestion worker commits chunk rows from its own session, which can land
  *between* the chunk purge and the document delete; the document's FK then
  rejects the delete and the whole request 500s.
  `FileDeletionService._purge_document_rows` retries inside a savepoint for
  exactly that window. An agent uploading over MCP and deleting moments later
  hits it routinely — and a hermetic test that stubs ingestion cannot see it.

## Exposing a collection over MCP (`app/mcp/`)

The MCP endpoint (`POST /api/mcp/collections/{id}`, see `docs/mcp.md`) is a
stateless Streamable HTTP server per collection. Its invariants:

- **The protocol layer is ours, and its spec rules live in one place.**
  `app/mcp/transport.py` owns every HTTP-level requirement (`Origin` → 403,
  unsupported `MCP-Protocol-Version` → 400, `Accept`, notification → 202, single
  JSON responses, no session id) and `app/mcp/gateway.py` owns the request
  sequence; the route is FastAPI wiring only. Conformance is pinned hermetically
  in `tests/mcp/test_transport_conformance.py` *and* checked live against real
  clients (official `mcp` SDK, Inspector CLI, `claude mcp add`) — a self-written
  server only stays in spec if a real client exercises it.
- **A tool's capability gate is the registry, not the tool.** Every `McpTool`
  declares its `ApiKeyCapability` and `tools/registry.build_tools` filters the
  set per request, so an ungranted capability's tools are absent from
  `tools/list` *and* unknown to `tools/call`. Checking inside a tool would
  advertise a tool the caller can only be refused.
- **Tool identity comes from `to_tool_read`, never a second projection.** Chat
  and MCP advertise the same names, descriptions, and parameter schemas because
  they read the same projection; execution goes through
  `ToolInvocationService`, so an agent call records the same query event and
  trace as a UI call.
- **Out-of-scope and non-existent answer identically (404).** A key holder must
  never be able to enumerate collections it was not granted, so the URL is
  convenience and the key is the boundary.
- **A key's collection scope is an explicit list, fixed at creation — there is
  no grant that absorbs collections created later.** Reach that widens on its
  own means a key issued today silently covers corpora nobody reviewed it
  against, and one leaked secret becomes every collection; a cross-collection
  credential belongs to a future workspace-level server, not a collection's key.
  `ApiKeyCreate.collection_ids` is `min_length=1`, so a scopeless key is
  unrepresentable rather than merely refused.
- **Capability implications (`CAPABILITY_IMPLIES`) are expanded at issuance, not
  at read time**, so the stored row and every listing state exactly what the key
  can do — expanding on read leaves the management UI understating the key's
  powers. `files:write` implies `files:read`: a key that can `delete_file` but
  not `list_files` cannot resolve the path it is meant to delete.
- **Tool execution failures are results with `is_error=True`, not JSON-RPC
  errors** (including invalid arguments — the 2025-11-25 spec asks for this so
  the model can self-correct). Only protocol faults (unknown method, unknown
  tool, malformed body) are JSON-RPC errors.
- **A tool result is model context: render values, never Python reprs.** An
  enum interpolated into tool text ships `DocumentStatus.READY` to an agent;
  read `.value`. DB-loaded enum columns are raw strings, so normalize
  (`FileNodeKind(node.kind)`) before calling `.value` on them.

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
- **A condition that is the expected state of a collection reports at `info`
  until it stops being expected.** Before the first ingestion run (`ctx.
  has_ingestion_run` — an ingest-triggered `PipelineRun` row, not a document
  count, since a `Document` exists from upload before any pipeline touches it)
  a missing or empty index is how a new collection looks, and flagging it as an
  error opens every fresh workspace on a failure the user cannot act on.
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
  strengthens every whole-enum gate — a new capability kind can trap users in the
  setup wizard on every page load.
- **Strong typing everywhere.** No `Any` as an escape hatch; no `isinstance`
  ladders in place of a schema or discriminated union. Python ≥3.11 house style:
  `X | None`, `list[X]`, `dict[K, V]` — not `Optional`/`List` (ruff `UP` flags
  them). The one legitimate `Any` fills a generic parameter that genuinely has no
  narrower type (SQLAlchemy `Column[Any]`, numpy `ndarray[Any, ...]`, a provider
  payload dict whose key set is genuinely open-ended) — never `Any` in place of a
  type you could write down.
- **`cast()` is never the fix for an `Optional`.** It hides the crash at the
  assignment and detonates downstream (a `cast(str, call_id)` masks a provider
  tool call with no id until it blows up far from the cast). Handle
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
  Two hand-synced loops drift, so a change to one silently skips the other; the
  single loop lives in
  `app/chat/run_loop.py` (parameterized by `stream`) and the single tool path in
  `app/chat/tools.py::ToolExecutor.execute`.
- **Docstrings on modules, classes, and functions** — contract and intent, not a
  restated signature. Comments explain *why* for non-obvious behavior only.
- **Lint-clean.** A `# noqa: <rule>` needs an adjacent comment saying why, and is
  never the fix for a design problem.
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
  the same in-memory object, and a test asserting on that same object passes
  anyway. Reassign a new dict or call `flag_modified`.
- **Streaming responses outlive the request handler.** A `StreamingResponse`
  generator runs after the function returns — anything it closes over must still be
  alive, and cleanup must handle mid-stream disconnects.
- **Persist partial stream content on *any* mid-stream termination, not just
  `GeneratorExit`.** Catching only client-disconnect loses streamed content
  whenever the provider raises mid-turn. The handler wraps
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
- **An optional SDK-model field left unset is not the same as omitted.** A model
  that serializes its whole `__dict__` (Pinecone's `IndexEmbed`) turns an unset
  optional into an explicit `null`, which the request layer then rejects on
  type — the call fails before it leaves the process, so no amount of reading
  the HTTP API explains it. State the value: a Pinecone sparse index takes
  `dotproduct`, the only metric it accepts.
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
  API 400s on an empty assistant history entry; fixtures that encode the shape
  you expect instead of a captured stream tail turn these into live-only bugs.
- **Never feature-detect a pinned SDK with `inspect.signature`.** A runtime probe
  is always-false dead code on the version actually pinned and silently no-ops
  whatever it gates. Introspect the *installed* SDK while
  writing the client, then call it directly — the lockfile guarantees the version.
- **Never `lru_cache` objects that own OS resources** (httpx clients, sessions,
  file handles): eviction drops the reference and whatever it owns leaks. Use an
  explicit cache that closes what it
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
  JSON-mutation bugs survive). And always close that fresh session — an
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
- **A test that writes an `app_settings` override deletes the row on teardown,
  not just `invalidate_app_config_cache()`.** The cache is process state but the
  override is a real row: leaving it changes what every later test reads from
  `get_app_config()`, and the failure lands in whichever unrelated test runs
  next — so it only reproduces under one test order.
- **A committed generated artifact is a function of the code, never of the
  exporting machine's configuration.** `scripts/export_readme_pipelines.py` pins
  the backend it renders because a node's default is read from app config;
  without that, exporting on a differently-configured deployment rewrites the
  file and its guard test fails for a reason unrelated to the change.
- **All patching goes through `monkeypatch`.** A bare module-attribute assignment
  outlives its test and poisons whatever runs next, order-dependently. And never
  build fakes with `SimpleNamespace(__str__=lambda: ...)`: dunder lookup happens on
  the type, so the fake passes for a reason unrelated to the behavior it claims to
  check.
