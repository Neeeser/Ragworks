# Collection diagnostics

A collection binds an **ingestion** pipeline and a **retrieval** pipeline. Those two
(plus the indexed data they share) can drift into configurations that make search
empty, misleading, or broken while every individual pipeline still validates — the
motivating case: ingestion is re-pointed at a different embedding model while
retrieval keeps the old one, so indexed vectors and query vectors live in different
spaces.

Ragworks is an experiment workbench, so such configurations stay **allowed**.
Diagnostics is the cross-pipeline surface that points them out so you can account for
them, never a gate that blocks saving, ingesting, or searching.

## Where it shows up

- **Collection → Diagnostics tab**: every finding, grouped by category.
- **Collection → Overview → Diagnostics card**: a compact status summary (error /
  warning counts + a consistency pill) linking to the tab. Both read the same
  `GET /api/collections/{id}/diagnostics` response.
- **Search page**: a failed query renders a structured, trace-linked explanation
  (the failed node + a "View trace" link) instead of a raw provider error.

## The model

Every finding is a `CollectionDiagnostic` (`app/schemas/diagnostics.py`) produced by a
registered rule — there are no one-off warning strings. The fields that matter:

- **`severity`** — `error` | `warning` | `info`. Non-blocking throughout, so this is a
  label, not a gate. **Error = a confirmed inconsistency that reliably yields broken,
  empty, or meaningless results** (e.g. mismatched embedding *model names*). A risk
  that is probably benign is a `warning` (e.g. the same model on two different
  connections). `info` is a neutral or degraded note (e.g. a probe that couldn't
  reach the store).
  A finding whose condition is the *expected* state of a collection reports at
  `info` until that stops being true: before a collection's first ingestion run,
  `missing_index` and `empty_index` are notes (the index is created on first
  ingest), and they become an error/warning once an ingestion run exists.
- **`confidence`** — `confirmed` (an observed condition) vs `heuristic` (a risk flag
  that may be benign). Severity and confidence are independent: an error is always
  confirmed; a warning may be either.
- **`category`** — `embedding`, `index_config`, `backend_storage`,
  `pipeline_compatibility`, `run_failures`, `node_config`, `data_freshness`
  (reserved; no rule yet). The tab groups by this.
- **`code`** — a stable identifier (e.g. `embedding_model_mismatch`). Persisted-facing
  in spirit; don't rename casually.
- **`resources` / `observations` / `action` / `links`** — what the finding refers to,
  the paired (ingestion-vs-retrieval) or single values behind it, the primary
  corrective route, and any navigational links (e.g. a run trace).

The response also carries `error_count`, `warning_count`, and a derived
**`consistent`** flag. `consistent` is `true` when there is no `error`-severity
finding in the `embedding`, `index_config`, `backend_storage`, or
`pipeline_compatibility` categories — it **deliberately ignores** `run_failures` and
`node_config` (a recent failed run does not mean the current *configuration* is
inconsistent). That is why the Overview pill reads "Configuration consistent", not
"nothing wrong".

## The rule engine

`CollectionDiagnosticsService.run(...)` (`app/services/diagnostics/service.py`) builds
a `DiagnosticContext` once per request, iterates `DIAGNOSTIC_RULES`
(`rules/registry.py`), and aggregates the findings. Each rule's `evaluate` is wrapped
so that a rule which throws degrades to a single `info` finding rather than sinking
the endpoint. The context resolves both pipeline sides **read-only** (it never
scaffolds or binds a default pipeline — a GET must not mutate), gathers recent run
history plus `has_ingestion_run` (any ingest-triggered `PipelineRun` row — a
`Document` exists from upload, before a pipeline touches it), and holds a
budget-bounded `VectorStoreProber` for the live index checks.

## Before a collection exists

`POST /api/collections/diagnostics/preview` takes the create payload's pipeline
fields (`ingest_pipeline_id`, `tool_pipeline_ids` in binding order) and returns the
same summary shape without a `collection_id`. The collection wizard calls it on a
debounce while the user picks pipelines, so a pairing the rules already flag — two
different embedding models, two different indexes — is visible before Create. The
warning is advisory: creating a collection to fix later stays allowed.

It runs the registered rules over a transient context (`preview.py`): an
unpersisted `Collection` and each side resolved through `resolve_unbound_pipeline`,
so nothing is written. Both sides resolve against the same placeholder collection,
which is what makes a cross-side comparison as true before creation as after.
Three rules are excluded, each with its reason in `EXCLUDED_PREVIEW_RULES`:
`index_probe` (the index is created by the first ingestion run, and the probe is a
network call on a path that re-runs per selection change) and the two
`recent_*_failures` rules (they read run history a nonexistent collection has none
of). Adding a rule to the registry means deciding which list it belongs in — a test
pins the pairing.

## Adding a rule

1. Write a rule class in the owning module under `rules/` (or a new module if it is a
   genuinely new concern). It declares `code: str`, `category: DiagnosticCategory`,
   and `evaluate(ctx) -> list[CollectionDiagnostic]`:

   ```python
   class MyRule:
       code = "my_check"
       category: DiagnosticCategory = "index_config"

       def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
           ingestion = ctx.ingestion_settings
           retrieval = ctx.retrieval_settings
           if ingestion is None or retrieval is None:
               return []  # a single resolved side can't be compared
           if not_a_problem(ingestion, retrieval):
               return []
           return [build_diagnostic(code=self.code, severity="warning", ...)]
   ```

2. Read the two sides only through `ctx.ingestion_settings` / `ctx.retrieval_settings`
   (and the run-history / prober accessors) — never re-resolve a pipeline or read a
   raw node-config dict. Tolerate either side being `None`.
3. Build findings with the `build_diagnostic` / `paired_observation` /
   `pipeline_resource` helpers in `rules/base.py`, so routes and observation shapes
   stay consistent.
4. Register one instance in `DIAGNOSTIC_RULES` (`rules/registry.py`).
5. Add per-rule unit tests in `tests/services/diagnostics/` (compatible vs mismatched
   inputs, and the tolerate-missing-side path). Live-probe rules must degrade to an
   `info` finding when the store is unreachable.

That is the whole extension surface — no schema change, no frontend form code (the tab
renders any finding), and no migration.
