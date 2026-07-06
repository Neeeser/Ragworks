# Backend Engineering Practices

Rules for working in `app/` (FastAPI + Pydantic v2 + SQLModel). Repo-wide rules — the
verify gates, the bug-fix regression-test rule, commit conventions — live in the root
`AGENTS.md`; this file covers how backend code is shaped, added to, and tested.

## The gate

Before finishing any backend change, run `make verify` — it chains, in order:

1. `make typecheck` — `mypy app`, with `disallow_untyped_defs = true` globally. New and
   refactored code must be fully typed and pass with zero errors.
2. `make lint` — `ruff check app tests` (imports, bugs, complexity, pytest style,
   pyupgrade, simplify) plus a slim `pylint` kept only for the design checks ruff
   doesn't cover (`too-many-arguments/branches/statements/locals`), at
   `--fail-under=10`. Module *length* is enforced by a guard test instead (below).
3. `make test` — the unit suite (`uv run pytest`), which excludes `tests/integration/`
   by default (see below).

All three must be green; `make verify` exits non-zero if any stage fails. Run
`make coverage` separately and review the `term-missing` output for untested lines you
introduced — coverage is not yet a blocking gate (a floor is planned for Phase 8).

**The live integration suite is opt-in, not part of the gate.** `tests/integration/`
hits real OpenRouter/Pinecone and needs `TEST_OPENROUTER_API_KEY`/`TEST_PINECONE_API_KEY`
configured; run it explicitly with `make test-integration`. Every test under
`tests/integration/` carries `pytestmark = pytest.mark.integration`, and its fixtures
(live `client`, `user_context`, `collection_factory`, the Pinecone namespace tracker,
etc.) live in `tests/integration/conftest.py`, not the root `tests/conftest.py`. The
root conftest only does environment bootstrapping (env file loading, DB/storage
redirection) and the function-scoped `session` fixture — it must never grow a hard
requirement on live credentials, or the whole unit suite stops collecting without them.

**mypy overrides are a burn-down list with a named owner-phase, never a pattern to
copy.** Every `[[tool.mypy.overrides]]` block in `pyproject.toml` is commented with the
phase that removes it (e.g. `# removed in Phase 5`) and exists only because that
module is getting rewritten, not because typing it properly is hard. Do not add a new
override for code you're writing today — type it correctly instead. The same rule
applies to `pyproject.toml`'s `[tool.ruff.lint.per-file-ignores]` burn-down entries.

**Module size is enforced by `tests/test_module_size.py`, which is the single source
of truth for the grandfathered list.** The rule: every module under `app/` stays at or
under 400 lines. The currently-oversize modules are grandfathered in that test's
`GRANDFATHERED` dict, each with a recorded line-count ceiling that may shrink but never
grow — the test fails if a new module exceeds 400 lines, if a grandfathered module
grows past its ceiling, or if an entry that has shrunk to ≤400 lines is still listed
(so the list can't rot). Never add an entry for new code, and never silence an oversize
module with a `# pylint: disable=too-many-lines` comment — one of those defeated the
gate for a 1,200-line module once. Phases 2–6 shrink the dict to empty.

## Layout — where code goes

```
app/
  api/             FastAPI app assembly + dependencies
    routes/        one router module per resource (collections.py, chat.py, …)
  schemas/         Pydantic wire types, one module per domain — the API contract
  clients/         typed external-API clients, one package per provider (openrouter/,
                   pinecone/)
  services/        business logic; orchestrates db + clients
  db/              session, migrations
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
                   execution/ (context.py, executor.py), tracing/ (recorder.py —
                   PipelineTraceRecorder; summaries.py — typed trace summary
                   models), nodes/ (node implementations, one module per
                   pipeline stage: io.py, parsing.py, chunking.py, embedding.py,
                   indexing.py, retrieval.py, plus validators.py for the
                   validation helpers shared across those stage modules)
  retrieval/       RAG components: chunkers, embedders, indexers, parsers,
                   rerankers, retrievers — one folder per pluggable stage
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
(`from app.chat.persistence import persist_base_prompt`). Re-exporting foreign symbols
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
  `db/session.py`, `core/security.py`, `pipelines/`, `services/` — to import upward
  from `app.api`; moved in Phase 2.)
- **Deployments must set `DEBUG=false`.** The fail-fast guard on the default JWT
  secret only fires outside debug mode, and `debug` defaults to `True` — under the
  default the guard is a no-op.
- **Routes are thin.** A route parses/validates input (via its Pydantic schema and
  `Depends`), calls one service function, and shapes the response. No business logic,
  no direct SQLModel queries, no external API calls in a route.
- **Services are where behavior lives.** They take typed inputs, use repositories and
  clients, return typed results, and raise domain errors. They must not import from
  `app.api` — a service that needs `HTTPException` is a route in disguise; raise a
  domain exception and translate it at the route.
- **Every service-raised domain error (`ValueError` today) must be translated at the
  route** — an untranslated domain error is a 500. When adding a route, write the
  failure-path test first, the way `routes/visualizations.py` wraps `UmapService`
  calls in `try/except ValueError`. (Longer-term: typed domain exceptions so routes can
  distinguish 400/404 without string matching.)
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
   `chat/`, `pipelines/`, `retrieval/`), typed end to end.
4. **Route** — endpoint in `app/api/routes/<resource>.py` with `response_model`, auth
   via the existing `Depends` helpers, and error translation.
5. **Tests** — service-level tests for the behavior, route-level tests for the contract
   (status codes, validation errors, auth), in the mirrored `tests/` folder.
6. If the frontend consumes it, update the hand-mirrored types in
   `frontend/src/lib/types/` (see `frontend/AGENTS.md`) in the same PR so they can't drift.

Then run the gate (`make test`, `make coverage`, `make lint`).

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
  No `Any`; no `isinstance` ladders as a substitute for a proper schema or a
  discriminated union. `requires-python = ">=3.11"` — PEP 604 unions (`X | None`) and
  builtin generics (`list[X]`, `dict[K, V]`) are the house style, including at runtime;
  don't write `Optional[X]` / `List[X]` in new code (ruff's `UP` rules flag them).
- **`cast()` is never the fix for an `Optional`.** It hides the crash at the assignment
  and detonates it downstream, further from the cause. Handle the `None` for real:
  supply a fallback, raise, or narrow with an actual check — we shipped a `cast(str,
  call_id)` in `app/chat/service.py` that masked a provider tool call with no `id`
  until it blew up as a Pydantic `ValidationError` inside `ToolCallTrace`.
- **Validate at the boundary, trust inside.** Pydantic validates at the route; internal
  code assumes valid data and stays on the happy path. Re-validating mid-stack is noise;
  *failing* to validate at the edge means garbage propagates until it crashes far from
  its source.
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
  "kept for later"; add it back when a real caller needs it.
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
  integrations, read the local docs in `external_api_documentation/` first — behavior
  there trumps memory.
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
  `build_default_ingestion_pipeline`/`build_default_retrieval_pipeline`.

## Wire-contract completeness

When a route shapes a response from a richer internal result, every schema field must
be populated from the result — a field left to its default (`warnings=[]`) is invisible
data loss the schema can't catch. When adding a field to a response schema, grep every
construction site.

## Testing philosophy

- **Test behavior, not wiring.** A test earns its place by failing when a real contract
  breaks. "Calling the service inserts a row and returns the schema with the generated
  id" is a test; "the route calls the service" (asserted via mock) is wiring — delete it.
- **Test at the lowest layer that exercises the behavior.** Pure logic (chunkers,
  processing, utils) as unit tests; orchestration at the service layer; route tests
  reserved for the HTTP contract itself — status codes, validation rejections, auth
  gating, response shape.
- **Realistic scenarios over synthetic ones.** Fixtures should look like real data
  (use `tests/assets/`); the valuable cases are the awkward ones — empty collections,
  unicode documents, a provider returning an error mid-stream — not the third
  happy-path permutation.
- **Mock at the boundary you don't own.** Fake OpenRouter/Pinecone at the client edge;
  never mock your own services to test your own routes — that pins implementation and
  proves nothing.
- **Tests that construct objects via `__new__` and monkeypatch private methods pin
  layout, not behavior — they are deleted, not migrated, on refactors.** A 580-line
  `test_chat_service_coverage.py` built `ChatService.__new__(ChatService)` and stubbed
  `_execute_tool_calls`/`_finalize_response`/`_stream_iteration` etc.; it broke wholesale
  the moment those privates moved, while asserting nothing a caller relies on. Drive the
  public entry point against a real session with the boundary stubbed (the
  `test_chat_service_flow.py` harness) so the test survives the next reshuffle.
- **Persistence assertions must read back through a fresh session**
  (`Session(session.get_bind())`, or expunge first). Asserting on the object the code
  under test just handled proves nothing — the session's identity map hands back the
  same in-memory instance, so the test passes even when nothing was ever written. The
  `update_collection_prompt` JSON-mutation bug survived precisely because its test
  read back through the same session.
- **Coverage is a floor, not a goal.** Use `term-missing` to find genuinely untested
  behavior, not to pad. It's fine to leave something untested *for a stated reason* —
  e.g. thin wrappers over a third-party SDK where the test would only re-assert the
  mock, or `db/migrations.py` glue exercised implicitly by every db test. Say so in the
  PR rather than writing a can't-fail test.
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
