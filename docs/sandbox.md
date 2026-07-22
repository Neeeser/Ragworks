# End-to-end testing with seeded scenarios

The sandbox harness puts a fully isolated copy of the app into a named, known
state with one command, so testing a feature never starts with registering
an account, walking the setup wizard, or hand-building collections and
pipelines. The scenario catalog — every seedable state and exactly what it
contains — is [sandbox-scenarios.md](sandbox-scenarios.md).

## Quick start

```bash
cp .env.sandbox.example .env.sandbox    # once; add your OpenRouter key
make sandbox-up SCENARIO=collection-ready
```

or directly:

```bash
uv run python -m sandbox up collection-ready
```

`up` resets the dedicated sandbox database, seeds the scenario through the app's
real service layer (real ingestion: real chunks, embeddings, pgvector + BM25
rows), starts the backend on **http://127.0.0.1:8010** and the frontend on
**http://127.0.0.1:3010**, and prints a handoff block: URLs, the seeded
login (`sandbox@ragworks.dev` / `ragworks-sandbox`), a ready-to-use JWT for direct
API calls, and one line per seeded object. The same block is saved to
`.sandbox/handoff.json`. Go straight to the feature under test — via the browser
with the printed login, or via the API with the printed token.

Other commands:

```bash
uv run python -m sandbox list             # scenarios + required keys
uv run python -m sandbox seed <name>      # reset + seed only, no servers
uv run python -m sandbox up <name> --backend-only   # skip the frontend
uv run python -m sandbox status           # what's running, last seeded scenario
uv run python -m sandbox logs backend     # tail a server log (or: frontend)
uv run python -m sandbox down             # stop both servers
uv run python -m sandbox docs             # regenerate sandbox-scenarios.md
```

## Browser testing with minimal steps

The handoff is designed so a browser session spends zero steps on setup
navigation:

1. **Skip the sign-in form.** Navigate to any frontend page, evaluate the
   one-line `browser_login` JS from the handoff (also printed by `up`) —
   it sets the session cookie and reloads authenticated. One evaluate call
   replaces the whole navigate → fill → submit → verify login sequence.
2. **Jump straight to the feature.** The handoff's `open:` lines are deep
   links to every seeded object (collection, files, eval dataset, …).
   Navigate directly; don't walk the nav.
3. **Assert through the API where a snapshot isn't the point.** The printed
   JWT works for any `curl -H "Authorization: Bearer <token>"` call against
   the backend — checking a run's status or a document's chunk count via the
   API is far cheaper than snapshotting a page. Save browser snapshots for
   the UI behavior actually under test.

## Isolation — what the harness touches

Nothing the harness does can affect dev state. It owns:

- the `ragworks_sandbox` database on the ParadeDB dev server (port 54329),
  dropped and recreated on every seed;
- the `.sandbox/` directory (gitignored): file storage, config (its own JWT
  secret), server logs, pidfiles, and the last handoff;
- ports 8010 (backend) and 3010 (frontend), so `make run` (8000/3000)
  coexists untouched.

Deleting `.sandbox/` and the `ragworks_sandbox` database is always safe.

## Provider keys

Real keys make the sandbox path real — actual OpenRouter embeddings and chat.
Keys live in the gitignored `.env.sandbox` (names documented in
`.env.sandbox.example`); the harness loads it itself and the app never reads it.
Each scenario declares which providers it needs, and the harness validates
those keys against the provider **before touching the database**, so a
missing or revoked key fails immediately with the variable's name instead of
seeding a half-working state. Keyless scenarios (`blank`, `fresh-user`) run
with no `.env.sandbox` at all.

Model defaults (embedding `openai/text-embedding-3-small`, chat
`openai/gpt-4o-mini`) are overridable in `.env.sandbox` via `SANDBOX_EMBEDDING_MODEL`
/ `SANDBOX_CHAT_MODEL`.

## Adding a scenario

Scenarios are small Python modules in `sandbox/scenarios/`, composing builders
from `sandbox/builders.py`. The registry metadata is the documentation — the
catalog is generated from it, and a test fails if the committed catalog is
stale.

1. **Reuse builders first.** `create_admin_user`, `add_openrouter_connection`,
   `create_pgvector_index`, `bootstrap_setup`, `ingest_assets`,
   `seed_eval_dataset` already cover account → provider → index → pipelines →
   collection → documents → eval dataset. A scenario is usually just a new
   ordering or subset, plus whatever is new about your feature.
2. **Add a builder only for a new object type.** Builders call the app's own
   services (never raw SQL, never routes), record what they made on the
   `SeedContext` — typed attributes for later builders, one `facts` line per
   created object so the handoff explains the state.
3. **Register the scenario:**

   ```python
   from sandbox.builders import create_admin_user
   from sandbox.context import SeedContext
   from sandbox.registry import scenario

   @scenario(
       name="my-feature-ready",
       description="One sentence: the state, and what's left to test.",
       requires=("openrouter",),          # provider keys the seed needs
       state=(                            # the catalog's bullet list — keep it exact
           "one admin user (the standard sandbox login)",
           "…each thing that exists after seeding…",
       ),
   )
   def seed(ctx: SeedContext) -> None:
       create_admin_user(ctx)
       ...
   ```

   To build on an existing state, call its seed function first (see
   `evals_ready.py`, which composes `collection_ready.seed`).
4. **Regenerate the catalog** — `uv run python -m sandbox docs` — and commit the
   updated `docs/sandbox-scenarios.md` with the scenario. The freshness test
   (`tests/sandbox/test_catalog.py`) fails the gate otherwise.
5. **Verify it live**: `uv run python -m sandbox up my-feature-ready`, then check
   the app shows exactly what the `state` bullets claim.

Sample documents live in `sandbox/assets/` — three fictional technical docs with
distinct topics so retrieval quality is checkable at a glance (the aurora
query should return the aurora document). Add new assets there when a
scenario needs different content, and reuse the existing ones otherwise.

## How it works (for maintainers)

- `sandbox/cli.py` applies the sandbox environment (`DATABASE_URL`, storage, config,
  CORS) **before importing any `app.*` module** — the db engine binds
  `DATABASE_URL` at import time. Keep app imports inside functions in this
  package.
- `sandbox/harness/db.py` reuses `scripts/ensure_postgres.py` for the server and
  the app's `init_db()` for schema — no parallel schema definition.
- `sandbox/harness/servers.py` runs uvicorn and `next dev` as detached process
  groups with pidfiles under `.sandbox/`, so any later session can `down` them.
- An external Postgres works via `SANDBOX_DATABASE_URL` (+ `DB_MODE=external`),
  with the same caveat as dev: without ParadeDB's `pg_search`, BM25 silently
  degrades.
