# Backend Engineering Practices

Rules for working in `app/` (FastAPI + Pydantic v2 + SQLModel). Repo-wide rules — the
verify gates, the bug-fix regression-test rule, commit conventions — live in the root
`AGENTS.md`; this file covers how backend code is shaped, added to, and tested.

## The gate

Before finishing any backend change, run `make verify` — it chains, in order:

1. `make typecheck` — `mypy app` with `strict = true`. New and refactored code must be
   fully typed and pass with zero errors; there is no per-module relaxation for our own
   code (see "mypy overrides" below for the one narrow exception).
2. `make lint` — `ruff check app tests` (imports, bugs, complexity, pytest style,
   pyupgrade, simplify) plus a slim `pylint` kept only for the design checks ruff
   doesn't cover (`too-many-arguments/branches/statements/locals`), at
   `--fail-under=10`. Module *length* is enforced by a guard test instead (below).
3. `make test` — the test suite (`uv run pytest`).

All three must be green; `make verify` exits non-zero if any stage fails. Run
`make coverage` separately and review the `term-missing` output for untested lines you
introduced — it is also a gate: `fail_under` in `pyproject.toml` is set a few points
below the last measured suite-wide percentage, so coverage can drift slightly but not
silently collapse. Lowering `fail_under` to make a change pass is not a fix; investigate
why coverage dropped first.

**The suite never hits live providers.** OpenRouter/Pinecone are stubbed at the
client boundary; no API credentials are needed to run any test. (A live-credential
`tests/integration/` suite existed once and was removed — it had rotted against
current model ids and wasn't part of any gate. If live smoke tests come back, they
return as an explicitly opt-in, marker-gated suite with its own conftest, never as
a credential requirement on the root `tests/conftest.py` — the root conftest only
does environment bootstrapping (DB/storage redirection, `DEBUG=true`) and the
function-scoped `session` fixture, so the suite always collects and runs without
secrets.)

**mypy overrides are for permanent third-party-stub gaps only, never a place to park
code you don't want to type.** The Phase 2–7 burn-down list of `ignore_errors = true`
overrides on our own modules (config, db, visualizations, `app.visualization.*`) is
gone as of Phase 8 — `strict = true` applies to every module we own. The one remaining
`[[tool.mypy.overrides]]` entry (`module = "umap"`) is a different kind of thing:
`umap-learn` ships no inline types and no stub package exists on PyPI, so
`ignore_missing_imports` there is permanent, not a burn-down item — there's nothing to
"finish" short of upstream shipping stubs. Don't add a new `ignore_errors` override for
code you're writing today — type it correctly instead. The same "burn-down, not a
parking lot" rule applies to `pyproject.toml`'s `[tool.ruff.lint.per-file-ignores]`
entries.

**Module size is enforced by `tests/test_module_size.py`, which is the single source
of truth for the grandfathered list.** The rule: every module under `app/` stays at or
under 400 lines. Oversize modules are grandfathered in that test's `GRANDFATHERED`
dict, each with a recorded line-count ceiling that may shrink but never grow — the test
fails if a new module exceeds 400 lines, if a grandfathered module grows past its
ceiling, or if an entry that has shrunk to ≤400 lines is still listed (so the list can't
rot). As of Phase 8 the dict is empty: every module in `app/` is at or under 400 lines.
Never add an entry for new code, and never silence an oversize module with a
`# pylint: disable=too-many-lines` comment — one of those defeated the gate for a
1,200-line module once.

## Layout — where code goes

```
app/
  api/             FastAPI app assembly + dependencies
    routes/        one router module per resource (collections.py, chat.py,
                   health.py, …) plus utils.py for shared route-translation helpers
                   (get_collection_or_404, to_http_exception)
  schemas/         Pydantic wire types, one module per domain — the API contract
  clients/         typed external-API clients, one package per provider (openrouter/,
                   pinecone/)
  services/        business logic; orchestrates db + clients. `errors.py` holds
                   the typed domain-error taxonomy every service raises.
                   prompts/ splits by responsibility: templates.py (defaults +
                   per-scope PromptVariable catalogs + get/set helpers),
                   context.py (render-context construction from domain models),
                   render.py (substitution + render_system_prompt's PromptContext
                   model) — package __init__.py re-exports the flat surface.
                   The collection file tree splits the same way: files.py
                   (FileSystemService — tree reads, folders, uploads, moves,
                   path resolution), file_deletion.py (the per-node purge
                   cascade, mirroring collection_deletion.py), file_search.py
                   (name/folder/content search), file_backfill.py (lifespan
                   backfill of pre-tree documents)
  db/              engine.py (process-wide Engine + session_scope/get_session),
                   bootstrap.py (init_db/ensure_database_exists), migrations.py,
                   schema.py (schema validation)
    models/        SQLModel tables, one module per domain (see below)
    repositories/  data access, one module per domain (see below)
  chat/            chat subsystem — facade + flat modules, one responsibility each:
                   service.py (facade), setup.py (ChatSetupBuilder), run_loop.py,
                   tools.py, branching.py, persistence.py, streaming.py,
                   parameters.py, reasoning.py, tool_calls.py, usage.py, events.py,
                   messages.py, state.py, and providers/ (base + openrouter)
  pipelines/       pipeline engine: ports.py (port types + compatibility), node.py
                   (PipelineNodeBase, NodeSpec), registry.py (NodeRegistry +
                   default_registry() singleton), validation.py (PipelineValidator),
                   definition.py (PipelineDefinition — the graph's wire shape),
                   settings.py (registry-driven config extraction —
                   resolve_ingestion_settings/resolve_retrieval_settings),
                   template.py (resolve_collection_template — collection-placeholder
                   substitution for index/namespace templates), defaults.py
                   (build_default_ingestion_pipeline/build_default_retrieval_pipeline —
                   the definitions new collections attach), payloads.py (Pydantic
                   payload models passed between nodes over ports),
                   execution/ (context.py, executor.py, runner.py — PipelineRunner,
                   the run-lifecycle bootstrap), tracing/ (recorder.py —
                   PipelineTraceRecorder; summaries.py — typed trace summary
                   models), nodes/ (node implementations, one module per
                   pipeline stage: io.py, parsing.py, chunking.py, embedding.py,
                   indexing.py, retrieval.py, plus validators.py for the
                   validation helpers shared across those stage modules)
  retrieval/       RAG components: chunkers, embedders, parsers, rerankers —
                   one folder per pluggable stage, plus the shared domain
                   models (models.py). chunkers/base.py holds the
                   `DocumentChunker` protocol; chunkers/strategies.py holds
                   every concrete strategy (Token/Sentence/Paragraph/Semantic
                   + `build_chunker`) — chunker implementations live here and
                   nowhere else. (Vector-index access used to live here as
                   indexers/ + retrievers/; it moved to vectorstores/, which
                   owns both data and control plane per backend.)
  vectorstores/    vector-database backends behind one interface: base.py
                   (`VectorStoreBackend` ABC + `VectorStoreCapabilities` +
                   IndexSpec/VectorIndexDescription + spec validation),
                   registry.py (get_vector_store — the single construction
                   and prerequisite-enforcement point — plus the lazy
                   per-run `VectorStoreProvider` and `backend_statuses`),
                   pinecone/ (store.py over app/clients/pinecone), pgvector/
                   (store.py + repository.py: catalog rows + dynamic
                   `vec_<name>` tables in the app's own Postgres)
  visualization/   embedding-visualization subsystems, one package per technique:
    umap/          UMAP projection compute (service.py, UmapService) + persistence
                   (repository.py, UmapRepository) — a subsystem package like
                   chat/ or pipelines/, deliberately outside services/
  core/            settings, auth primitives, cross-cutting config
  utils/           small pure helpers only
tests/             mirrors the app/ layout (tests/api, tests/services, …)
```

New code goes in the existing folder that owns its concern. A new folder is justified
only when it names a genuinely new ownership boundary (the way `retrieval/rerankers/`
does), not to house one file — colocate a single file with its consumer instead.

**A package folder needs ≥2 cohesive modules; single-file folders collapse into their
consumer.** A directory holding one module (plus `__init__.py`) is not a boundary — it's
overhead. Chat's `processing/`, `persistence/`, and `streaming/` folders each held a
single implementation file and were collapsed to root modules (`parameters.py`,
`reasoning.py`, `tool_calls.py`, `persistence.py`, `streaming.py`) in Phase 4.3;
`providers/` stayed a package because it genuinely holds two (`base.py`, `openrouter.py`).

**A subsystem's `__init__` exports its public API only.** `app/chat/__init__.py` exports
`ChatService` and nothing else; consumers import other names from the owning submodule
(`from app.chat.persistence import persist_session_preferences`). Re-exporting foreign symbols
(`PipelineService`, `get_settings`, …) so a test can monkeypatch them through the package
is forbidden — patch at the real boundary where the name is used (e.g. tests patch
`app.chat.setup.resolve_retrieval_settings`, not a re-export on the package).

**`pipelines/nodes/` modules group by pipeline stage, not by node count.** Each
module (`io.py`, `parsing.py`, `chunking.py`, `embedding.py`, `indexing.py`,
`retrieval.py`) owns every node/config for one stage of the ingestion or
retrieval flow — a stage with several fixed-shape variants (the chunkers) shares
one base class in its module rather than duplicating `run()`/`summarize_io()`
per variant. **Cross-node validation lives in small named helpers, not one
60-line per-node method.** `nodes/validators.py` holds helpers shared across
stage modules (e.g. `missing_index_issue`, used by both the indexer's and the
retriever's `validation_issues_for_node`); a helper used by only one node's
validator (e.g. `_dimension_issue` in `indexing.py`) stays local to that module.
**Validation reads config through the node's config model, never through the
raw config dict.** `validation_issues_for_node` calls `SomeConfig.model_validate
(node.config or {})` and reads fields off the validated model — the same model
`NodeRegistry.create` uses to build the node that actually runs. Peeking at
`node.config["index_name"]` directly would silently diverge from runtime
behavior the moment the config model's defaults or validation change.

**Run lifecycle (run row + trace recorder + executor + context) has one owner:
`PipelineRunner`** (`pipelines/execution/runner.py`). Ingestion and retrieval both
need the same four things wired together for every run — a `PipelineRun` row, a
`PipelineTraceRecorder` bound to it, a `PipelineExecutor`, and the `PipelineRunContext`
nodes execute against — so `PipelineRunner.start()` builds all four and hands back a
`PipelineRunHandle`; `PipelineRunner.execute()` runs a definition against it. Terminal
run status stays owned by `PipelineTraceRecorder` (the executor calls
`mark_run_completed`/`mark_run_failed` on it automatically); a caller that needs to
fail a run for a reason outside `execute()` (e.g. persistence failing after a
successful pipeline run) calls `handle.trace.mark_run_failed(exc)` directly rather than
hand-rolling the same status/`error_message`/`completed_at` update inline — that
exact duplication between `services/ingestion.py` and `services/retrieval.py` is what
`PipelineRunner` replaced.

**Config resolution is registry-driven — hardcoding a node type-id string outside the
node class that owns it is a lockstep bug.** `pipelines/settings.py`'s
`resolve_ingestion_settings`/`resolve_retrieval_settings` read a node's type id off the
node *class* (`EmbedderNode.type`, not the literal `"embedder.openrouter"`), and for the
one case with several interchangeable variants (fixed-strategy chunkers) walk the
*registry's* node classes to find whichever one is present rather than maintaining a
type-id-to-strategy table that duplicates what each chunker class already declares via
its own `type`/`strategy` attributes. If you add a new fixed-strategy node variant, it
gets picked up automatically as long as it's registered — no second place to update.

**A collection's ingestion/retrieval pipeline is resolved in exactly one place:
`app/services/pipeline_resolution.py`.** `resolve_ingestion_pipeline`/
`resolve_retrieval_pipeline` run the ensure-defaults → attach-to-collection →
load-pipeline → validate-kind → resolve-settings sequence once; every caller —
`IngestionService`, `RetrievalService`, chat's `ChatSetupBuilder`, and the collection
services that render a prompt (`CollectionService`) or purge a namespace
(`CollectionDeletionService`) — calls through them instead of repeating it. They raise
`PipelineResolutionError` (an `InvalidInputError`, so routes map it to a 400) — never
`HTTPException`. Tests that need to stub resolution patch these functions at the
importing module's boundary (e.g. `app.chat.setup.resolve_retrieval_pipeline`), not a
re-export.

**One module per domain in `db/models/`.** Tables are split by domain —
`user.py` (User + `TimestampMixin`), `collection.py`, `document.py`, `pipeline.py`,
`chat.py`, `visualization.py`, `events.py`. A new table goes in its domain module (or
a new one, if it's a genuinely new domain — not a grab bag). `db/models/__init__.py`
re-exports every table plus the `app.schemas.enums` aliases (`models.ChatRole`, etc.)
as a permanent flat namespace: importers use `from app.db import models` (or
`from app.db.models import X`) exactly as before the split — never reach into a
domain submodule (`app.db.models.chat`) from outside the package.

## The dependency direction

`routes → services → db/external clients`, with `schemas` used at the edges. Never
invert it:

- **Settings live in `app/core/config.py`.** Nothing below `app/api` may import from
  `app.api` — `core` imports nothing above it, and the import direction is
  `core ← schemas ← db/clients ← domain packages ← services ← api`. (Settings used to
  live under `app/api`, which forced every module that needed config —
  `db/engine.py`, `core/security.py`, `pipelines/`, `services/` — to import upward
  from `app.api`; moved in Phase 2.)
- **`DEBUG` defaults to `false` — deployments are secure by default.** An unset
  `JWT_SECRET_KEY` is auto-generated on first boot and persisted under the config
  path (`_load_or_create_jwt_secret` in `app/core/config.py`), so a paste-and-run
  install signs tokens with a real secret; the fail-fast guard rejects an explicit
  `changeme` placeholder unless `DEBUG=true` is set. Dev entry points opt into
  debug: `make server` exports `DEBUG=true` and the test suite sets it in
  `tests/conftest.py`. Never flip the default back to `True`.
- **`config_path` (small persistent app state) is deliberately separate from
  `storage_path` (bulk, reclaimable uploads)** — in Docker they are different
  volumes (`backend-config` vs `document-storage`), so clearing document storage
  to reclaim space never destroys identity material like the JWT secret. New
  persistent app state (not user uploads) goes under `config_path`.
- **Routes are thin — target ≤ ~25 lines each: parse → one service call → shape/
  translate.** A route parses/validates input (via its Pydantic schema and `Depends`),
  calls one service function, and shapes the response or translates a domain error. No
  business logic, no direct SQLModel queries, no external API calls, no multi-step
  orchestration in a route. (Pragmatism over dogma on the line count — a route that
  reads top-to-bottom as those three moves is fine; one that hides a fourth is the
  smell.)
- **Admin-only surface hangs off one router.** `/api/admin/*` routes live in
  `app/api/routes/admin.py`, whose router carries
  `dependencies=[Depends(require_admin)]` — a new admin route added to it is
  gated by construction. Never add a per-route admin check somewhere else;
  extend this router. Roles are the `UserRole` enum (`app/schemas/enums.py`)
  stored as a string column on `User`. The first registered user becomes admin
  (the count check and insert share one session; note this is best-effort —
  two truly concurrent first registrations under READ COMMITTED could each
  mint an admin, an accepted risk on a first-boot empty database);
  `ensure_admin_exists` promotes the earliest account on startup for upgraded
  deployments. `AdminUserService` owns the last-admin invariant: demoting or
  deactivating the only remaining active admin is an `InvalidInputError`.
- **Destructive, multi-step operations are services with named steps.** A deletion
  cascade that spans stores (Pinecone namespace + file storage + relational rows, like
  `CollectionDeletionService`) is never inlined in a route: it's a service whose steps
  read as named private methods (`_purge_vectors`/`_purge_files`/`_purge_rows`) so the
  sequence and its ordering constraints live in one auditable place.
- **Services are where behavior lives.** They take typed inputs, use repositories and
  clients, return typed results, and raise domain errors. They must not import from
  `app.api` — a service that needs `HTTPException` is a route in disguise. Subsystem
  packages (`chat/`, `pipelines/`, `retrieval/`, `visualization/`) sit at the same
  layer as `services/` and follow the same rules — a domain big enough to own several
  cohesive modules gets its own package; `services/` holds the single-module domains.
- **Services raise typed domain errors; a bare `ValueError` is not an API contract.**
  The taxonomy lives in `app/services/errors.py`: `NotFoundError` (→404),
  `InvalidInputError` (→400), `ExternalServiceError` (→502), all subclassing
  `ServiceError` and carrying a `detail` (str or per-field dict). Services raise these;
  routes translate with `to_http_exception` (`app/api/routes/utils.py`) in a single
  `except ServiceError` — never map status codes by string-matching a message, and never
  leave a domain error untranslated (that's a 500). `PipelineResolutionError` subclasses
  `InvalidInputError`; chat's `routes/chat.py` used to bridge onto this taxonomy via a
  transitional `ValueError` base (tagged `TODO(chat-error-taxonomy)`) — that bridge is
  gone: every `raise ValueError` in `app/chat/*.py` (persistence, setup, branching,
  tools) now raises `InvalidInputError`, and `routes/chat.py` catches `ServiceError`
  like every other route. The "not found" cases in that migration (missing session/
  message) were mapped to `InvalidInputError` (400), not `NotFoundError` (404), to
  preserve the exact status codes the frontend already depends on — semantically some
  read as 404s, but changing the wire contract wasn't in scope. New services skip
  `ValueError` entirely.
- **A genuinely external failure (Pinecone/OpenRouter) is classified at the service
  boundary, not left to surface raw.** `is_external_provider_error` (`app/services/
  errors.py`) matches the SDK/HTTP exception families those clients actually raise
  (`httpx.HTTPError`, `openai.OpenAIError`, `pinecone.exceptions.PineconeException`);
  `RetrievalService.query_collection` and `IngestionService.ingest_upload` catch broad
  `Exception` around pipeline execution (to mark the run/document FAILED either way)
  and re-raise as `ExternalServiceError` only when that check matches — an internal bug
  in node logic still surfaces as itself, not a misleading "upstream is down".
- **`app/services/traces.py`'s `TraceService` owns trace resolution; `routes/traces.py`
  only translates `TraceNotFoundError` to a 404.** Building a `PipelineTraceResponse`
  from a run — including the run's own pinned `PipelineVersion` vs. its pipeline's
  current one — used to be two private helpers living in the route module, reaching
  straight into `session.get(...)` for documents and query events; that's a service's
  job. `PipelineRunRead`/`PipelineNodeRunRead`/`PipelineNodeIORead` are built via
  `model_validate(row)` (`ConfigDict(from_attributes=True)`), not field-by-field
  copying — every declared field is a plain column on the corresponding db model.
- **All query logic lives on a repository (`app/db/repositories/`).** Routes and
  services never build `select()`/`delete()` statements inline; add or extend a
  repository method so query logic has one home and one set of tests. Repositories
  share `base.Repository` (which owns the session) and are split one-per-domain,
  re-exported from `app.db.repositories` as a permanent flat namespace — never reach
  into a domain submodule from outside the package. If two tests in different files
  assert the same repo behavior, one of them is deleted.
- **Schemas ≠ db models.** `app/schemas/*` are the wire contract; `app/db/models/`
  is persistence. Convert explicitly at the service boundary. Returning a db model
  straight from a route couples your API to your table shape and leaks fields you
  didn't mean to expose (`response_model` is the safety net, not the design).
- **Domain enums live in `app/schemas/enums.py`; `db.models` imports them, never the
  reverse.** The wire contract must not transitively depend on SQLModel. A schema that
  needs a db type only for a `from_model()` type hint imports it under
  `if TYPE_CHECKING:` (annotations stay valid because every schema module starts with
  `from __future__ import annotations`) — it must not appear as a real top-level import.
- **The engine (`pipelines/`) never defines wire types — `app/schemas/pipelines.py`
  owns the contract and may re-export.** `PipelineDefinition` (the pipeline graph) is
  the one exception: it lives in `pipelines/definition.py` and schemas re-export it,
  because it's genuinely both the engine's input and the wire shape — duplicating it
  in `schemas/` would just be a second copy that drifts. Everything else the engine
  exposes on the wire (the node catalog, validation results) gets its own
  `schemas`-owned model (`NodeSpecRead`, `PipelineValidationResponse`) mapped from the
  engine type at the route (`NodeSpecRead.model_validate(spec, from_attributes=True)`
  when field names match exactly) — never a schema subclassing or re-exporting an
  engine class directly. Registry is built once: routes and services call
  `app.pipelines.registry.default_registry()`, not `build_default_registry()` (which
  stays for tests that want a guaranteed-fresh instance).

## Adding a feature end-to-end

The expected shape, in order:

1. **Schema** — define request/response models in the right `app/schemas/<domain>.py`.
   Design the contract first; it forces the data-shape conversation before the code one.
2. **DB** — if persistence changes: model in its domain module under
   `app/db/models/`, migration in `app/db/migrations.py`, repository methods in
   the matching domain module under `app/db/repositories/`.
3. **Service** — the behavior, in `app/services/<domain>.py` (or the owning subsystem:
   `chat/`, `pipelines/`, `retrieval/`, `visualization/`), typed end to end.
4. **Route** — endpoint in `app/api/routes/<resource>.py` with `response_model`, auth
   via the existing `Depends` helpers, and error translation.
5. **Tests** — service-level tests for the behavior, route-level tests for the contract
   (status codes, validation errors, auth), in the mirrored `tests/` folder.
6. If the frontend consumes it, update the hand-mirrored types in
   `frontend/src/lib/types/` (see `frontend/AGENTS.md`) in the same PR so they can't drift.

Then run the gate (`make verify`, `make coverage`).

## Adding a config setting

Runtime-editable behavior is a field on `AppConfig` (`app/schemas/app_config.py`),
never a new `Settings` field in `app/core/config.py` — see "Configuration
architecture" in the root `AGENTS.md` for why the two layers stay separate.

1. **Field** — add it to the right section model (`AuthSettings`, `UploadSettings`,
   `ModelDefaults`, `FeatureFlags`, or a new section) with `Field(default=...,
   json_schema_extra=_meta(label, description, public=..., env_var=...))`. The code
   default here is what an un-overridden install runs with; `env_var` names a
   `Settings` field that pins it read-only when that variable is set (see
   `_ENV_PINNED_SETTINGS_ATTR` in `app/services/app_config.py`, which needs the
   matching one-line entry).
2. **Enforcement/read site** — read it through `get_app_config()` at the point of
   use, never `get_settings()` — that's the whole point of a runtime-editable
   setting. Never cache the returned `AppConfig` object across requests or at
   import time; call `get_app_config()` fresh at each read (it's already
   TTL-cached internally, see the FastAPI pitfall below).
3. **Public wire model** — if the field is public (the frontend needs it before or
   without auth), add it to `PublicConfig`'s section model in
   `app/schemas/app_config.py` *and* its hand-mirror in
   `frontend/src/lib/types/config.ts` in the same PR. A field with no `public=True`
   never reaches `PublicConfig.from_app_config` — that's deliberate (see the class
   docstring), not an oversight to "fix" by making everything public.
4. **Test the enforcement red-green** — same rule as any behavior change: a test
   that flips the field via `AppSettingRepository.upsert` (or a PATCH through the
   admin route), invalidates the cache, and asserts the enforcement site's actual
   behavior (403/400/413/404, or the resolved default), not just that
   `effective_config()` returns the right value.

The admin settings page needs no frontend work for a new field beyond the
`PublicConfig` mirror above — it renders from `GET /api/admin/config`'s catalog
(`iter_config_fields()`), so a new leaf just appears. It only needs new frontend
code if it introduces a new `ConfigFieldKind` (bool/int/string/string_list today).

## Vector-store backends (`app/vectorstores/`)

- **Adding a backend is a checklist, not a scavenger hunt:** implement
  `VectorStoreBackend` in a new package under `app/vectorstores/`, declare its
  `VectorStoreCapabilities`, register it in `registry.py`, add its `IndexBackend`
  enum value, and add one indexer + one retriever node subclass in
  `app/pipelines/nodes/` (the shared bases own run/summarize/validation). The
  wizard and index manager pick it up from `GET /api/indexes/backends`.
- **Capabilities are data, declared once.** A backend's hard limits (max indexed
  dimension, supported metrics/vector types, name rule, batch/top_k caps) live
  only on its `VectorStoreCapabilities`. Every enforcement site — create-index
  validation, pipeline node validation, upsert batching, the frontend forms —
  reads them off the backend; re-hardcoding a limit anywhere else (including the
  frontend) is a lockstep bug. Verified values: pgvector caps at 4,096 indexed
  dimensions (fp32 HNSW stops at 2,000; above that the repository builds the
  HNSW index over a `halfvec` fp16 cast expression while the column stays
  full-precision `vector`, and queries must go through the same cast or the
  planner won't use the index — needs pgvector >= 0.7.0, checked with a clear
  `InvalidInputError` at create time), Pinecone at 20,000.
- **`get_vector_store` is the single prerequisite gate.** Requesting Pinecone
  without a user key, or pgvector while the extension is unavailable, raises
  `InvalidInputError` there (→ 400). Routes never check provider keys for vector
  access up front — `require_openrouter_key` is the only key gate on collection/
  document/search routes, and Pinecone is enforced lazily when a pipeline
  actually resolves to it (`chat/setup.py` mirrors this for tool collections).
- **pgvector dynamic DDL is safe only because names are validated first.** Data
  tables are `vec_<name>` with `-`→`_`; every identifier derives from an index
  name that already passed the strict `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` rule
  (≤45 chars, shared with Pinecone so names stay portable). Values always travel
  as bound parameters; embeddings bind through `pgvector.sqlalchemy.VECTOR`
  typed bindparams. Importing `pgvector.sqlalchemy` also registers the
  `vector` type for SQLAlchemy reflection — `app/db/schema.py` imports it for
  exactly that, so boot-time inspection of `vec_<name>` tables doesn't warn.
- **The extension is best-effort at bootstrap.** `ensure_pgvector_extension`
  (`app/db/bootstrap.py`) runs `CREATE EXTENSION IF NOT EXISTS vector` (pgvector
  is not a trusted extension, so this needs superuser — true in the shipped
  compose); on failure it logs and flips `app/db/pgvector_support.py`'s
  availability flag instead of failing startup. Dev machines need the extension
  for the full suite (`brew install pgvector` for Homebrew Postgres);
  pgvector-dependent tests use the root `pgvector_session` fixture and skip
  with a named reason when it's missing.
- **Node type ids are permanent.** Persisted pipeline definitions reference
  `indexer.pinecone`/`retriever.pinecone`/`indexer.pgvector`/`retriever.pgvector`
  by string; a new backend adds new ids, never renames existing ones.
- **Per-document vector deletion goes through `delete_document_vectors`** on the
  backend ABC (chunk vector ids are `{document_id}:{order}` — Pinecone lists by
  id prefix, pgvector filters its `document_id` column). Never delete a whole
  namespace to remove one file.

## The collection file tree (`file_nodes` + `documents`)

- **A `FileNode` is identity and hierarchy; a `Document` is the ingestion
  record.** Files exist regardless of ingestion: no document row = type not
  eligible for the pipeline; `failed` always carries `error_message`; `ready`
  always means indexed chunks. Never create a state that reads as "ingested
  with zero chunks" — that ghost is what this split removed.
- **Uploads always persist; eligibility only gates auto-ingestion.**
  `uploads.allowed_content_types` is the auto-ingest list, not an upload gate
  (`is_ingestible` in `app/services/files.py`). `POST /api/files/{id}/ingest`
  force-attempts regardless, so a pipeline upgraded to support a type just
  works — the parser's own error is the honest outcome otherwise.
- **Background ingestion opens its own `session_scope`** (`run_document_ingestion`
  in `app/services/ingestion.py`) — a FastAPI background task runs after the
  request session is gone. It never re-raises: the FAILED document row *is* the
  outcome; the wrapper only logs.
- **Stored bytes are keyed by node id** (`collections/{cid}/files/{node_id}`),
  so rename/move never touches disk. Sibling-name uniqueness is enforced in
  `FileSystemService` (Postgres unique indexes treat NULL `parent_id` as
  distinct, so a DB constraint can't cover root siblings).
- **The `?parent_id` listing + `FileSystemService.resolve_path` are the
  model-navigation surface** (`ls`/`cd` semantics for future chat tools) — keep
  their shapes stable; extend rather than fork them.

## Hooking into telemetry

Telemetry (`app/telemetry/`) records lightweight, aggregatable activity facts to
the local `telemetry_events` table for the admin dashboards. It is internal-only:
nothing is ever sent externally. Its one invariant: **recording never breaks the
feature being recorded** — `record()` opens its own short `session_scope()`
(never the request session) and swallows any failure with a logged warning, a
deliberate documented exception to the never-swallow rule, scoped to that module.

1. **Event model** — add a Pydantic model in `app/telemetry/events.py` with a
   unique dotted `type` literal (`"chat.turn_completed"` style) and add it to the
   `TelemetryEvent` union. `user_id` comes from the shared base; everything else
   in the payload should be aggregatable scalars, not blobs.
2. **Hook** — call `record(SomeEvent(...))` at the service-layer site where the
   fact becomes true, *after* the owning transaction commits (telemetry must
   observe outcomes, never participate in them). Never hook in a route — the one
   exception is login, which has no service; the route says so in a comment.
3. **Aggregation** — only if a dashboard consumes it, add a query method to
   `TelemetryRepository`; dashboards never query the table directly.
4. **Test** — drive the real entry point and assert the row landed
   (`tests/telemetry/test_instrumentation.py` is the pattern); the recorder's
   own behavior (kill switch, never-raises, retention) is already pinned in
   `tests/telemetry/test_recorder.py` — don't re-test it per event.

**Boundary rule:** heavyweight operational records that power features stay
domain tables (`QueryEvent`/`IngestionEvent` feed the trace UI); telemetry rows
are the aggregatable activity facts beside them — a flow like retrieval
deliberately writes both. One table for all event types, on purpose: adding an
event never needs a migration. `telemetry.enabled` (kill switch) and
`telemetry.retention_days` (startup purge, `purge_expired` in the lifespan) are
AppConfig fields like any other.

## Fixing a bug

Follow the root rule: **regression test in the same commit, verified red-green.**

1. Reproduce with a failing test placed at the lowest layer that exhibits the bug
   (pure function > service > route). Watch it fail for the bug's reason — not an
   import error or fixture typo.
2. Fix. Watch it pass. Run the full gate.
3. If the bug reveals a rule future contributors need ("validate X at the boundary",
   "this client must be closed"), add one line to the relevant section of this file.

## Code quality standards

- **Strong typing everywhere.** Typed signatures, return types, and attributes.
  No `Any` as an escape hatch; no `isinstance` ladders as a substitute for a proper
  schema or a discriminated union. `requires-python = ">=3.11"` — PEP 604 unions
  (`X | None`) and builtin generics (`list[X]`, `dict[K, V]`) are the house style,
  including at runtime; don't write `Optional[X]` / `List[X]` in new code (ruff's `UP`
  rules flag them). The one legitimate use of `Any` is filling a generic type
  parameter mypy strict mode requires but that genuinely has no narrower type: a
  SQLAlchemy `Column[Any]` (the column's Python value type isn't expressible without
  duplicating SQLAlchemy's own type machinery), a numpy `ndarray[Any, np.dtype[...]]`
  (numpy's stubs don't track array rank), or a provider payload dict (`dict[str,
  Any]`) whose key set is genuinely open-ended (see the data-oriented-design
  corollary below) — never `Any` in place of a type you could actually write down.
- **`cast()` is never the fix for an `Optional`.** It hides the crash at the assignment
  and detonates it downstream, further from the cause. Handle the `None` for real:
  supply a fallback, raise, or narrow with an actual check — we shipped a `cast(str,
  call_id)` in `app/chat/service.py` that masked a provider tool call with no `id`
  until it blew up as a Pydantic `ValidationError` inside `ToolCallTrace`.
- **Validate at the boundary, trust inside.** Pydantic validates at the route; internal
  code assumes valid data and stays on the happy path. Re-validating mid-stack is noise;
  *failing* to validate at the edge means garbage propagates until it crashes far from
  its source.
- **A defensive raw-dict fallback living beside a Pydantic schema means the schema is
  wrong or the fallback is dead — fix the schema, delete the fallback, and let
  `ValidationError` surface.** `OpenRouterEmbedder._extract_vectors` used to carry an
  `isinstance`/raw-dict fallback for envelope shapes `OpenRouterEmbeddingsResponse`
  already validates; the client's `model_validate` call is the single place that shape
  is enforced, so a second check downstream was either unreachable or, worse, silently
  papering over a schema that didn't match reality. The one thing that's *not* covered
  by this rule: a field genuinely typed `Any` because the schema can't pin its shape
  down (e.g. `OpenRouterEmbeddingItem.embedding`) still needs a real check at first use —
  that's not defending against the schema, it's doing the validation the schema
  couldn't. **Protocol stub bodies are `...`, never `return None`** — a stub that returns
  a real value looks like a default implementation instead of an unreachable structural
  marker, and invites subclasses to rely on it.
- **Data-oriented design: model the data first.** Most backend bugs here are shape bugs.
  Prefer explicit Pydantic models over dicts-of-dicts; prefer `Enum`/`Literal` over
  stringly-typed modes; make illegal states unrepresentable rather than checked. Any
  dict that crosses a function boundary with a stable key set is a Pydantic model —
  message dicts, event dicts, usage dicts were the bug farm here (see
  `app/chat/events.py`, `app/chat/messages.py`, `app/chat/usage.py`). Discriminated
  unions for event/message variants; hand-rolled coercion functions are Pydantic
  validators in disguise (`app/schemas/chat_parameters.py`). The corollary: a dict with
  a genuinely open-ended, provider-defined key set (raw OpenRouter usage payloads with
  provider-specific extras) is *not* a stable key set — don't force one into a strict
  model just to satisfy this rule; model the known aggregate separately and let the raw
  payload pass through.
- **OO where there's state, functions where there isn't.** Classes earn their existence
  by owning a resource or invariant (a repository owning a session, a client owning an
  `httpx.Client`). Stateless logic is a module-level function — don't wrap it in a
  class for ceremony.
- **Small files, one responsibility.** A module you can't summarize in one sentence is
  two modules. Split before, not after, it becomes a grab bag.
- **Don't abstract on the first occurrence — or even reflexively on the second.**
  Duplication is cheaper than the wrong abstraction. Extract when a third use appears
  or when two copies must change in lockstep (that's a latent bug, not duplication).
  Never add a parameter, base class, or plugin hook for a future caller that doesn't
  exist yet.
- **A streaming and non-streaming variant of the same operation share one
  implementation** — the variant is a parameter (or the caller drains the iterator).
  Two hand-synced loops/constants are a latent bug, not duplication: the chat
  send/stream paths had drifted (a module `MAX_TOOL_ITERATIONS` *and* a local
  `max_iterations`, plus two near-identical tool loops differing only in two `yield`s),
  so a change to one silently skipped the other. The single loop lives in
  `app/chat/run_loop.py` (parameterized by `stream`) and the single tool path in
  `app/chat/tools.py::ToolExecutor.execute` (an iterator; non-streaming callers drain
  it without forwarding).
- **Docstrings on modules, classes, and functions** — they should state contract and
  intent ("returns None when the user has no keys"), not restate the signature.
  Comments explain *why* for non-obvious behavior only.
- **Pylint-clean.** Fix warnings; a `# pylint: disable=` needs an adjacent comment
  saying why, and is never the fix for a design problem.
- **Dead code is deleted on sight** — unused params, endpoints, schemas. A parameter
  or symbol with no caller (grep before deleting, and report the grep) is not
  "kept for later"; add it back when a real caller needs it. **This includes whole
  dead layers, not just symbols.** `app/retrieval/indexing.py`'s `DocumentIndexer`
  and `app/retrieval/chunkers/text.py`'s `FixedSizeTextChunker` were a parallel
  ingestion path with zero production callers (real ingestion runs through the
  pipeline nodes in `pipelines/nodes/`) — an unexecuted parallel implementation
  drifts silently from the one that's actually running, and its tests only assert
  that the dead code agrees with itself, not that anything real works. Dead layers
  are deleted, not preserved "in case"; grep for callers before deleting and report
  the grep either way.
- **Import-time side effects are forbidden**, with one deliberate exception: the
  process-wide db `engine` (`app/db/engine.py`) is created at import time because
  SQLAlchemy's own guidance is one engine per process, reused for its life. Every
  other setup step — schema bootstrap, backfills, logging config — lives in a
  function called from `main.py`'s `lifespan`, not at module scope, so importing a
  module for its types never has side effects.

## FastAPI / Pydantic pitfalls (this stack, specifically)

- **Sync by default, `async def` only when you mean it.** This backend uses sync `def`
  routes (FastAPI runs them in a threadpool) with a sync SQLModel `Session` and
  `httpx.Client`. The one unforgivable mix: an `async def` route that makes a blocking
  call (sync DB session, `httpx.Client`, `time.sleep`) — it stalls the entire event
  loop and every in-flight request, and no test will catch it because it "works" under
  zero concurrency. If an endpoint must be async (streaming responses, as in
  `routes/chat.py`), everything it awaits must be genuinely async.
- **No mutable default arguments, and no `Depends()` results stored globally.** Both
  are classic share-state-across-requests bugs. Request-scoped state comes from
  dependencies; process-scoped clients are created once at startup, deliberately.
- **Pydantic v2 semantics.** Use `model_validate` / `model_dump`, not the v1 `.dict()` /
  `.parse_obj()`. `model_dump(mode="json")` when you need JSON-safe primitives (UUIDs,
  datetimes). Field defaults are validated at class definition — a mutable default needs
  `default_factory`.
- **SQLModel models are not fully-validating Pydantic models.** `table=True` models skip
  validation on construction. That's another reason schemas and db models stay separate:
  validation lives in `app/schemas`, persistence in `app/db/models`.
- **Sessions have one owner.** Request-scoped sessions come from the `get_session`
  dependency; don't open ad-hoc sessions inside services that already received one, and
  don't let a session escape the request that created it (detached-instance errors show
  up far from their cause).
- **Never mutate a JSON column in place** (`model.extra_metadata[key] = value`,
  `.pop(...)`, `.update(...)`): our JSON columns aren't wrapped in `MutableDict`, so
  the session never sees the change and **nothing is written** — the response still
  looks right because it's the same in-memory object. Reassign a new dict
  (`model.extra_metadata = {**model.extra_metadata, key: value}`) or call
  `flag_modified(model, "field")`. We shipped exactly this bug in
  `update_collection_prompt`; its test passed for months via object identity.
- **Streaming responses outlive the request handler.** A generator passed to
  `StreamingResponse` runs after the function returns — anything it closes over
  (session, client) must still be alive, and cleanup must handle the client
  disconnecting mid-stream.
- **Persist partial stream content on *any* mid-stream termination, not just
  `GeneratorExit`.** The chat run loop caught only client-disconnect and lost the
  streamed-so-far assistant content whenever the provider raised mid-turn. The
  abort/failure handler wraps `(GeneratorExit, Exception)` around the token-streaming
  step (only that step — the assistant tool-call message is already committed by the
  time tool execution runs, so widening the scope would double-persist), records the
  partial, and re-raises so the route still emits an `error` SSE event. Never swallow.
- **Resolve a client-supplied `session_id` against the current user, and reject one
  owned by another user as a domain error.** `ensure_session` looks up the id scoped to
  the user; if it's absent for this user but exists for someone else, raise
  `ValueError("Chat session not found.")` rather than trying to create a row under a
  colliding primary key (which surfaced as an opaque `IntegrityError`/500 and is a
  cross-user access attempt).
- **External-API code lives in `app/clients/<provider>/`, typed end to end.** Each
  provider gets its own package (`app/clients/openrouter/`) with a client module (HTTP/
  SDK calls, timeouts set explicitly) and typed request/response models — the schemas in
  `app/schemas/` are the source of truth, so a client method returning `dict` is a bug,
  not a shortcut. Split out a same-package module (e.g. `catalog.py`) for
  caching/shaping logic that doesn't itself do I/O, taking the transport as injected
  callables so it stays unit-testable without a fake HTTP client. Before changing these
  integrations, read the local docs in `docs/external-api/` first — behavior
  there trumps memory.
- **Never send OpenRouter an explicit embeddings `dimensions` unless the user
  asked for one.** Most embedding models reject the parameter outright ("does
  not support matryoshka representation") — the wizard/inspector deliberately
  set only `model_name` and let the model emit its native dimension; the
  indexer node alone carries `dimension` (for index creation/validation). And
  when the embeddings envelope carries an `error` instead of `data`,
  `OpenRouterEmbedder` raises `ExternalServiceError` with the provider's
  message (502), never a bare `ValueError` (500).
- **Never feature-detect a pinned SDK with `inspect.signature`.** `app/clients/pinecone/`
  used to probe `create_index`'s parameters at runtime (twice — once in the route, once
  in the indexer) to decide whether `metadata_config` was supported; on the SDK version
  actually pinned in `uv.lock`, that kwarg had been removed entirely, so the probe's
  branch was always-false dead code silently no-opping a config field. Pin behavior to
  the documented version and let the lockfile guarantee it — introspect the *installed*
  SDK (`python -c "import inspect, pinecone; print(inspect.signature(...))"`) while
  writing the client, then call it directly; don't ship runtime feature-detection for a
  dependency version you already control.
- **Never `lru_cache` objects that own OS resources** (httpx clients, sessions, file
  handles): eviction just drops the reference, so whatever it owns leaks — we had this
  exact bug on `get_openrouter_client`. Use an explicit cache (e.g. an `OrderedDict` +
  lock) that calls `close()` on whatever it evicts, and never key a long-lived cache on
  a raw secret you can't invalidate on demand (a rotated/leaked API key stays cached
  until it ages out).
- **`get_app_config()` is TTL-cached (30s) at module scope** (`app/services/
  app_config.py`) — a test that mutates a DB override via `AppSettingRepository`
  (or PATCHes `/api/admin/config`) and then asserts on the new value must call
  `invalidate_app_config_cache()` after the write, or it reads the stale cached
  config. `tests/api/test_config_routes.py`, `tests/api/test_config_enforcement.py`,
  `tests/services/test_app_config_service.py`, and `tests/pipelines/
  test_defaults_config.py` each carry the same autouse fixture (clear on setup
  *and* teardown, since the module-level cache otherwise leaks into whichever test
  runs next):
  ```python
  @pytest.fixture(autouse=True)
  def _invalidate_cache() -> Iterator[None]:
      invalidate_app_config_cache()
      yield
      invalidate_app_config_cache()
  ```
- **Import-time `settings = get_settings()` snapshots are forbidden**, even though
  `get_settings()` is itself `lru_cache`d and cheap to call repeatedly. A module-level
  `settings = get_settings()` captures the value once at import time; code that reads it
  later never sees a settings change (env var override, `get_settings.cache_clear()` in a
  test) made after that import. Call `get_settings()` at the point of use instead — inside
  a function body, or in a Pydantic field's `default_factory` (`Field(default_factory=
  lambda: get_settings().pinecone_index_name)`) — so the read happens at
  call/instantiation time, not import time. Every pipeline node config's settings-backed
  default follows this pattern (`EmbedderConfig.model_name`, `IndexerConfig.index_name`,
  `RetrieverConfig.index_name`, `ChatSettingsConfig.chat_model`), as do
  `build_default_ingestion_pipeline`/`build_default_retrieval_pipeline`. There are exactly
  two documented exceptions, both already covered by the import-time-side-effects
  exception above: `app/db/engine.py`'s process-wide engine construction (needs
  `database_url` once, at the moment the singleton `Engine` is created), and
  `app/api/main.py`'s app assembly (`app = FastAPI(...)` and the CORS middleware
  registration need `settings.cors_origins` at module scope because `app` is the object
  uvicorn imports directly as `app.api.main:app` — there's no factory call for a lifespan
  hook to run before middleware registration). Every other module-level `settings =
  get_settings()` is the bug this rule exists to catch — convert it to a call-time read.

## Wire-contract completeness

When a route shapes a response from a richer internal result, every schema field must
be populated from the result — a field left to its default (`warnings=[]`) is invisible
data loss the schema can't catch. When adding a field to a response schema, grep every
construction site.

## Testing philosophy

- **Test behavior, not wiring.** A test earns its place by failing when a real contract
  breaks. "Calling the service inserts a row and returns the schema with the generated
  id" is a test; "the route calls the service" (asserted via mock) is wiring — delete it.
  The tell: if you deleted the code under test and the test still passed (or the only
  thing that could break it is a rename), it was never testing behavior. We ran this
  exercise across the suite in Task 7.1 and deleted on that basis: an `isinstance`
  round-trip over two dependency helpers, a mock-driven `init_db` test that stubbed
  eight of its own internals to force a branch, and half of `test_migrations.py`
  (SQL-string-echo assertions that checked a stub connection's recorded statements for
  substrings, and orchestration tests that monkeypatched `_constraint_signature` to
  force a code path — testing the mock, not the migration).
- **Test at the lowest layer a real bug would actually appear.** Pure logic (chunkers,
  processing, utils, a default-resolution helper like `_resolve_default_sql`) as unit
  tests; orchestration at the service layer; route tests reserved for the HTTP contract
  itself — status codes, validation rejections, auth gating, response shape. Don't test
  a pure function's behavior by driving it through three layers of orchestration when a
  direct call exercises the same contract for a fraction of the setup.
- **Route tests go through `TestClient`, not a direct function call.** A test that calls
  the route function with hand-built args and `current_user`/`session` kwargs exercises
  none of what the HTTP layer does — auth dependencies, request-body validation (422),
  response serialization, ownership isolation — so it's a service test wearing a route
  test's clothes; put it in `tests/services/`. Genuine route tests use the `client` /
  `unauthed_client` fixtures (`tests/api/conftest.py`): `TestClient(app)` with
  `get_session`/`get_current_user` overridden. The high-value HTTP contracts, swept
  resource-agnostically in `tests/api/test_route_contract.py`, are: 401 without a token,
  cross-user 404 on get/update/delete (the ownership-isolation matrix — the costliest
  bug class), 422 on a malformed create body, and response bodies that never serialize a
  secret (`hashed_password`, provider API keys).
- **Realistic scenarios over synthetic ones.** Fixtures should look like real data
  (use `tests/assets/`); the valuable cases are the awkward ones — empty collections,
  unicode documents, a provider returning an error mid-stream — not the third
  happy-path permutation.
- **Exercise failure paths as deliberately as the happy path, especially at a
  provider boundary.** A service that talks to Pinecone/OpenRouter has at least two
  contracts: what it returns on success, and what a caller sees when the provider is
  down, rate-limited, or rejects the credential. `RetrievalService`/`IngestionService`/
  `ChatService` each have a boundary-stubbed test that raises the real SDK exception
  (`pinecone.exceptions.PineconeException`, `openai.RateLimitError`/`AuthenticationError`)
  and asserts the *typed* outcome (`ExternalServiceError` -> 502, or the streaming
  `ErrorEvent` the route already emits) — not just that the happy path maps chunks
  correctly. An expired-JWT rejection through `get_current_user` is the same idea
  applied to auth: the failure path is the contract worth pinning, not a footnote to
  the success test.
- **Mock at the boundary you don't own.** Fake OpenRouter/Pinecone at the client edge;
  never mock your own services to test your own routes — that pins implementation and
  proves nothing.
- **Tests that construct objects via `__new__` and monkeypatch private methods pin
  layout, not behavior — they are deleted, not migrated, on refactors.** A 580-line
  `test_chat_service_coverage.py` built `ChatService.__new__(ChatService)` and stubbed
  `_execute_tool_calls`/`_finalize_response`/`_stream_iteration` etc.; it broke wholesale
  the moment those privates moved, while asserting nothing a caller relies on. Drive the
  public entry point against a real session with the boundary stubbed (the
  `test_chat_service_flow.py` harness) so the test survives the next reshuffle. The same
  goes for reload-the-module-to-observe-an-import-time-side-effect tests
  (`test_main_logging.py`'s `importlib.reload` gymnastics, deleted in Task 7.1 by moving
  the logging setup it existed to test into a plain `configure_logging()` function): if
  a test needs machinery like that to observe behavior, the behavior is in the wrong
  shape, not the test.
- **A test that must be updated whenever anything changes is measuring layout, not
  behavior — delete it.** This cuts both ways with the coverage number: meaningfully
  lower coverage from deleting real wiring/mock-echo tests beats a larger suite padded
  with tests that assert nothing and break on every unrelated refactor. When a test's
  only failure mode is "the code moved," it was never load-bearing.
- **Persistence assertions must read back through a fresh session**
  (`Session(session.get_bind())`, or expunge first). Asserting on the object the code
  under test just handled proves nothing — the session's identity map hands back the
  same in-memory instance, so the test passes even when nothing was ever written. The
  `update_collection_prompt` JSON-mutation bug survived precisely because its test
  read back through the same session. **And always close that fresh session**
  (`with Session(session.get_bind()) as fresh:`) — an unclosed read-back session sits
  idle-in-transaction and deadlocks the next test's `DROP SCHEMA` reset, hanging the
  whole suite.
- **Coverage is a floor, not a goal, and an untested line needs a stated reason, not
  silence.** Use `term-missing` to find genuinely untested behavior, not to pad. Named
  reasons we've actually used: a thin wrapper over a third-party SDK where the test
  would only re-assert the mock; `db/migrations.py` orchestration glue (`apply_missing_
  columns`/`ensure_indexes`/`ensure_foreign_keys`) exercised implicitly, against real
  Postgres, by every `test_bootstrap.py` case — a second copy mocking the same
  functions' internals proves only that the mock was called; a defensive branch genuinely
  unreachable through any real caller (`init_db`'s schema-still-invalid-after-healing
  path — every gap `SchemaValidationResult` can detect is one `create_all`/
  `apply_missing_columns` already heals, so the branch has no live path to force
  cheaply). Say so in the PR rather than writing a can't-fail test.
- **Never write tests that execute Protocol/ABC stub bodies or assert
  `NotImplementedError` on abstract methods:** they assert nothing a user cares about
  and rot silently when signatures change (we had two such files broken on main for
  weeks).
- **All patching goes through `monkeypatch`.** A bare module-attribute assignment
  (`some_module.thing = stub`) outlives the test that made it — nothing undoes it, so
  it poisons every test that runs after in the same process, order-dependently. And
  never build fake objects with `SimpleNamespace(__str__=lambda: ...)`: dunder lookup
  happens on the type, not the instance, so `str()` ignores the assigned attribute and
  falls back to `SimpleNamespace`'s own repr — a test built this way can pass for a
  reason that has nothing to do with the behavior it claims to check.

## Known gaps (deliberate, tracked — not license to add more)

- **Admins cannot hard-delete users.** `PATCH /api/admin/users/{id}` supports
  deactivation only; deleting an account means cascading Pinecone namespaces,
  file storage, and relational rows (a `CollectionDeletionService`-scale job).
  Add the cascade service and its tests together when prioritized.
- **Provider API keys are stored plaintext at rest.** `User.openrouter_api_key` and
  `User.pinecone_api_key` (`app/db/models/user.py`) are plain `Text` columns with no
  encryption-at-rest. Pre-existing and tracked, not introduced by this pass; the wire
  contract is guarded by `test_me_response_excludes_secrets`
  (`tests/api/test_route_contract.py`), which fails if either key ever leaks into a
  response body. Encrypting the column is future work, not a blocker for this PR.
