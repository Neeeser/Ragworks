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
  services/        business logic; orchestrates db + external clients
  db/              repositories, session, migrations
    models/        SQLModel tables, one module per domain (see below)
  chat/            chat subsystem (providers, streaming, persistence, processing)
  pipelines/       pipeline engine + nodes/
  retrieval/       RAG components: chunkers, embedders, indexers, parsers,
                   rerankers, retrievers — one folder per pluggable stage
  core/            settings, auth primitives, cross-cutting config
  utils/           small pure helpers only
tests/             mirrors the app/ layout (tests/api, tests/services, …)
```

New code goes in the existing folder that owns its concern. A new folder is justified
only when it names a genuinely new ownership boundary (the way `retrieval/rerankers/`
does), not to house one file — colocate a single file with its consumer instead.

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
- **DB access goes through `app/db/repositories.py`.** Routes and services don't build
  raw `select()` statements inline; add or extend a repository method so query logic
  has one home and one set of tests.
- **Schemas ≠ db models.** `app/schemas/*` are the wire contract; `app/db/models/`
  is persistence. Convert explicitly at the service boundary. Returning a db model
  straight from a route couples your API to your table shape and leaks fields you
  didn't mean to expose (`response_model` is the safety net, not the design).
- **Domain enums live in `app/schemas/enums.py`; `db.models` imports them, never the
  reverse.** The wire contract must not transitively depend on SQLModel. A schema that
  needs a db type only for a `from_model()` type hint imports it under
  `if TYPE_CHECKING:` (annotations stay valid because every schema module starts with
  `from __future__ import annotations`) — it must not appear as a real top-level import.

## Adding a feature end-to-end

The expected shape, in order:

1. **Schema** — define request/response models in the right `app/schemas/<domain>.py`.
   Design the contract first; it forces the data-shape conversation before the code one.
2. **DB** — if persistence changes: model in its domain module under
   `app/db/models/`, migration in `app/db/migrations.py`, repository methods in
   `app/db/repositories.py`.
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
  discriminated union. Note `requires-python = ">=3.9"` — use `Optional[X]` /
  `List[X]` (or `from __future__ import annotations`), not bare `X | None` at runtime.
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
  stringly-typed modes; make illegal states unrepresentable rather than checked.
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
- **Docstrings on modules, classes, and functions** — they should state contract and
  intent ("returns None when the user has no keys"), not restate the signature.
  Comments explain *why* for non-obvious behavior only.
- **Pylint-clean.** Fix warnings; a `# pylint: disable=` needs an adjacent comment
  saying why, and is never the fix for a design problem.

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
- **External calls (OpenRouter, Pinecone) live in their client/service module** with
  timeouts set explicitly. Before changing these integrations, read the local docs in
  `external_api_documentation/` — behavior there trumps memory.
- **Never `lru_cache` objects that own OS resources** (httpx clients, sessions, file
  handles): eviction just drops the reference, so whatever it owns leaks — we had this
  exact bug on `get_openrouter_client`. Use an explicit cache (e.g. an `OrderedDict` +
  lock) that calls `close()` on whatever it evicts, and never key a long-lived cache on
  a raw secret you can't invalidate on demand (a rotated/leaked API key stays cached
  until it ages out).

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
