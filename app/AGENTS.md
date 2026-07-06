# Backend Engineering Practices

Rules for working in `app/` (FastAPI + Pydantic v2 + SQLModel). Repo-wide rules — the
verify gates, the bug-fix regression-test rule, commit conventions — live in the root
`AGENTS.md`; this file covers how backend code is shaped, added to, and tested.

## The gate

Before finishing any backend change:

- `make test` — full pytest suite must pass.
- `make coverage` — review the `term-missing` output for untested lines you introduced.
- `make lint` — pylint on `app/`; fix everything your diff introduces.

Use `make coverage-report` for non-blocking runs while iterating.

## Layout — where code goes

```
app/
  api/             FastAPI app assembly + dependencies
    routes/        one router module per resource (collections.py, chat.py, …)
  schemas/         Pydantic wire types, one module per domain — the API contract
  services/        business logic; orchestrates db + external clients
  db/              SQLModel models, repositories, session, migrations
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

## The dependency direction

`routes → services → db/external clients`, with `schemas` used at the edges. Never
invert it:

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
- **Schemas ≠ db models.** `app/schemas/*` are the wire contract; `app/db/models.py`
  is persistence. Convert explicitly at the service boundary. Returning a db model
  straight from a route couples your API to your table shape and leaks fields you
  didn't mean to expose (`response_model` is the safety net, not the design).

## Adding a feature end-to-end

The expected shape, in order:

1. **Schema** — define request/response models in the right `app/schemas/<domain>.py`.
   Design the contract first; it forces the data-shape conversation before the code one.
2. **DB** — if persistence changes: model in `app/db/models.py`, migration in
   `app/db/migrations.py`, repository methods in `app/db/repositories.py`.
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
- **Streaming responses outlive the request handler.** A generator passed to
  `StreamingResponse` runs after the function returns — anything it closes over
  (session, client) must still be alive, and cleanup must handle the client
  disconnecting mid-stream.
- **External calls (OpenRouter, Pinecone) live in their client/service module** with
  timeouts set explicitly. Before changing these integrations, read the local docs in
  `external_api_documentation/` — behavior there trumps memory.

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
- **Coverage is a floor, not a goal.** Use `term-missing` to find genuinely untested
  behavior, not to pad. It's fine to leave something untested *for a stated reason* —
  e.g. thin wrappers over a third-party SDK where the test would only re-assert the
  mock, or `db/migrations.py` glue exercised implicitly by every db test. Say so in the
  PR rather than writing a can't-fail test.
- **Never write tests that execute Protocol/ABC stub bodies or assert
  `NotImplementedError` on abstract methods:** they assert nothing a user cares about
  and rot silently when signatures change (we had two such files broken on main for
  weeks).
