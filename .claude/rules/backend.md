---
paths:
  - "app/**"
  - "tests/**"
---

# Backend Engineering Practices

Rules for working in `app/` (FastAPI + Pydantic v2 + SQLModel). Repo-wide rules in
the root `CLAUDE.md` apply here too.

## The gate

Before declaring any backend change done, run `make verify` — typecheck (`mypy app`,
`strict = true`, zero errors), lint (`ruff check app tests sandbox`, including
the PLR09xx design budgets), then test (`uv run pytest --cov`).
All three must be green — the test stage carries coverage, so the suite runs
once. Review `term-missing` for untested lines you introduced; lowering
`fail_under` to make a change pass is not a fix, find out why coverage dropped.
This is the *full* gate — run it once when the work is done, not
per edit; the per-edit fast tier (ruff + mypy + the touched area's tests with
`-n 0`) lives in the root `CLAUDE.md`. The suite is parallel by default
(pytest-xdist, per-worker template-copied databases); pass `-n 0` for a quick
single-file run so worker startup doesn't dominate.

- **The suite never hits live providers.** OpenRouter/Pinecone/Ollama are stubbed at
  the client boundary; no API credentials are needed to run any test. If live smoke
  tests ever return, they come back as an explicitly opt-in, marker-gated suite with
  its own conftest — never as a credential requirement on the root
  `tests/conftest.py`, which only does environment bootstrapping and the `session`
  fixture, so the suite always collects and runs without secrets.
- **mypy/ruff overrides are for permanent third-party-stub gaps only**
  (`pacmap`, `sklearn.*`, `numba` ship no types and no stub packages exist).
  Never add `ignore_errors` or a per-file ignore for code you're writing today.
- **Module size: every module under `app/` stays ≤400 lines**, enforced by
  `tests/test_module_size.py`. Never add a `GRANDFATHERED` entry or silence the
  gate — split the module.

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
  prompting/       the unified {{variable}} template engine: grammar + per-context
                   variable catalogs (below pipelines and services, so both render
                   through one engine)
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
  their consumer.**
- **A subsystem's `__init__` exports its public API only** (`app/chat/__init__.py`
  exports `ChatService`, nothing else); consumers import other names from the owning
  submodule. Re-exporting foreign symbols so a test can monkeypatch through the
  package is forbidden — patch at the real boundary where the name is used
  (e.g. `app.chat.setup.resolve_retrieval_settings`, not a package re-export).
- **PaCMAP runs only in the projection subprocess
  (`app/visualization/insights/projection_worker.py`), never in the app
  process.** pacmap's faiss+numba OpenMP runtimes clash with the sklearn this
  process loads, in platform-dependent init orders that segfault or deadlock —
  an in-process call works on one machine and kills the worker on another. The
  child module stays import-light (numpy only at module level) and warms numba
  before pacmap is even imported; `insights/__init__` stays lazy for the same
  reason.
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
  calls, or multi-step orchestration in a route. (The count is a guide; the
  violation is hidden orchestration.)
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
   Contract first.
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
architecture" in the root `CLAUDE.md`.

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
   same PR. Fields without `public=True` never reach `PublicConfig` — deliberate.
4. **Test the enforcement red-green** — flip the field via
   `AppSettingRepository.upsert` (or admin PATCH), invalidate the cache, and assert
   the enforcement site's actual behavior (403/400/413/…), not just that
   `effective_config()` returns the value.

The admin settings page renders from the config catalog, so a new field needs no
frontend form code — only a new `ConfigFieldKind` would.

## The collection file tree (`file_nodes` + `documents`)

- **A `FileNode` is identity and hierarchy; a `Document` is the ingestion record.**
  Files exist regardless of ingestion: no document row = not pipeline-eligible;
  `failed` always carries `error_message`; `ready` means a parse node read the
  file. A parsed file yielding zero items (a whitespace-only text file) is an
  honest empty READY; a file every parse node declined fails the run
  (`_require_a_parse_node_read_the_file`) — a READY nothing actually read
  would claim an ingestion that did not happen.
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
  or shipping — the runtime operator owns collection (12-factor).
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
  ladders in place of a schema or discriminated union. The one legitimate `Any`
  fills a generic parameter with no narrower type (SQLAlchemy `Column[Any]`,
  numpy `ndarray[Any, ...]`, an open-ended provider payload dict) — never `Any`
  in place of a type you could write down.
- **`cast()` is never the fix for an `Optional`.** It hides the `None` at the
  assignment and the crash surfaces downstream, far from the cause (a
  `cast(str, call_id)` masks a provider tool call with no id). Handle the
  `None`: fallback, raise, or narrow with a real check.
- **Validate at the boundary, trust inside.** Pydantic validates at the route;
  internal code assumes valid data. Unvalidated edges let garbage crash far from
  its source; re-validating mid-stack is noise.
- **A defensive raw-dict fallback beside a Pydantic schema means the schema is
  wrong or the fallback is dead** — fix the schema, delete the fallback, let
  `ValidationError` surface. Exception: a field genuinely typed `Any` still needs a
  real check at first use — that's doing the validation the schema couldn't.
  **Protocol stub bodies are `...`, never `return None`** — a stub returning a real
  value reads as a default implementation and invites subclasses to rely on it.
- **Data-oriented design: model the data first.** Most backend bugs here are shape
  bugs. Any dict crossing a function boundary with a stable key set is a Pydantic
  model (see `app/chat/events.py`, `messages.py`, `usage.py` for the pattern);
  discriminated unions for variants; hand-rolled
  coercion functions are Pydantic validators in disguise. Corollary: a genuinely
  open-ended provider-defined dict is *not* a stable key set — model the known
  aggregate separately and let the raw payload pass through.
- **OO where there's state, functions where there isn't.** A class owns a
  resource or invariant; stateless logic is a module-level function.
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
  (threadpool) with a sync `Session` and `httpx.Client`. Never make a blocking
  call in an `async def` route — it stalls the whole event loop, and no test
  catches it because it works under zero concurrency. If an endpoint must be
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
  type — the call fails before it leaves the process, so the HTTP API docs
  never explain it. State the value: a Pinecone sparse index takes
  `dotproduct`, the only metric it accepts.
- **Never send an embeddings `dimensions` parameter unless the user asked for
  one** — most embedding models reject it outright, so an unset
  `EmbedderConfig.dimension` transmits nothing and the model emits its native
  width. A set value is a real request (Matryoshka models truncate) and is both
  transmitted and authoritative. When the embeddings envelope carries an `error`
  instead of `data`, raise `ExternalServiceError` with the provider's message
  (502), never a bare `ValueError` (500).
- **What we transmit is not what the pipeline knows: an empty
  `EmbedderConfig.dimension` never means the width is unknown.** The model's
  native width is discoverable, so `app/pipelines/embedding_dimensions.py`
  compares it with the index's and fails the save on a mismatch. Reading the
  empty field as "unknown" makes a correct pipeline warn about itself and
  defers a real mismatch to a per-document ingest failure.
- **The index's width is the indexer's `dimension` *or the registered index it
  names*, in that order.** Scaffolded pipelines name an index and leave
  `dimension` blank, so a node-field-only check is silent on every default
  pipeline — the common shape, not an edge case. A blank field means "created
  at whatever the first embedding measures" only while the index does not
  exist; once it does, it means writing 768d vectors into a 1536d store. The
  registry lookup is injected into the validator (`index_width`) exactly like
  the provider resolvers, because `app/pipelines` may not import from
  `app.services`. An index no registration answers for is genuinely unknown —
  silent for a native width, advisory for an explicit Matryoshka request.
- **A model's width is resolved through `resolve_embedding_width` — catalog
  first, probe second, both answers cached including `None`.** Most providers
  publish no dimension in their catalog (OpenRouter publishes none for any
  embedding model), so a catalog-only resolver answers `None` almost
  everywhere and every width check silently does nothing. What must never sit
  on the validation path is an *uncached* probe, not the probe: validation
  re-runs on a debounce while the editor is open, so one live embedding call
  per keystroke is the failure mode — and `cached_embedding_dimension` drops a
  `None`, which is why the combined answer is retained in its own cache
  instead. One probe ever for a resolvable model, one per freshness window
  otherwise. A width that resolves neither way emits nothing.
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
  needs settings at module scope). Never add another module-level snapshot.

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
