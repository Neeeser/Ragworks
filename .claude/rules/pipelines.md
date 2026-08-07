---
paths:
  - "app/pipelines/**"
  - "app/prompting/**"
  - "app/services/prompts/**"
  - "app/evals/**"
  - "tests/pipelines/**"
  - "tests/prompts/**"
  - "tests/evals/**"
---

# Pipeline Engine, Prompts, and LLM Nodes

Rules for the pipeline engine (`app/pipelines/`), the prompt library
(`app/prompting/` + `app/services/prompts/`), and evals (`app/evals/`).
`backend.md` applies here too.

## Pipeline engine

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
- **A node declares which modalities it *processes* (`accepts`), separately
  from what it *demands* of the stream (`requires`).** Breaching `requires`
  is a validation error; items outside `accepts` are partitioned at run time
  by one shared implementation (`app/pipelines/partition.py`) and follow the
  port's `unaccepted` policy — `exclude` for sinks, `passthrough` for
  transforms. A skip rule written inside a node is invisible to the trace and
  drifts from what the editor predicted. Use `requires` only where the graph
  can genuinely guarantee the facet (retrieval-side text); a mixed stream
  makes a hard `requires` reject sound graphs.
- **A parse node consumes the file items its registry answers for and passes
  every other item through** (`nodes/parse_base.py`). That is what lets the
  parse nodes fan out in parallel from `ingestion.input` and rejoin through
  `merge.items` into one downstream chain; wiring one parse node behind
  another starves it of file items, which the "accepts cannot intersect
  anything reaching it" finding reports.
- **A file every parse node declined fails the document; a file that was
  parsed and held nothing does not.** Parse nodes record per-item
  handled/unhandled outcomes on `PipelineRunContext.parse_report`, and
  ingestion fails a zero-chunk run whose file no node read — otherwise a
  force-ingested format nothing parses lands `ready` with no chunks. A
  branch skipping a file another branch handled stays a trace warning:
  that is what fan-out looks like, and raising it to the document would
  warn on every ordinary upload.
- **Which formats a parse node handles is registry data
  (`app/retrieval/parsers/`), never node-local skip logic and never graph
  shape.** A handler added to a registry upgrades every pipeline that already
  wired the node; a format decided by a branch in the graph needs graph
  surgery in every stored definition to extend, and a skip rule written inside
  a node is invisible to the trace and to the editor's analysis.
- **A node's registry reaches the wire as `handled_content_types`, and
  `content_type_claim` is what a config-dependent claim overrides** (a text
  parser configured to decode unknown formats claims every type).
  `app/pipelines/content_coverage.py` unions the claims of the parse nodes an
  edge actually reaches and warns for each auto-ingestable type
  (`uploads.allowed_content_types`, injected as a resolver) none of them
  claims — such an upload starts a run that indexes nothing, and the run
  reports success.
- **An image transform is an items→items node accepting `image` with
  `passthrough`, and whatever it writes goes under the document's derived
  directory** (`app/pipelines/nodes/image_transform.py`, via
  `store_derived_image`). A restricted-accepts passthrough port is what lets
  it sit anywhere after parsing with no router, and the delete/re-ingest
  purge removes exactly that directory — bytes written elsewhere outlive the
  document they came from.
- **A finding names a node by its label, falling back to its type.** A node id
  interpolated into a message names nothing a user can find on the canvas.
- **Only two modality findings are ever reported, because only two are
  unambiguous in an arbitrary graph** (`app/pipelines/modality.py`): a node
  whose `accepts` cannot intersect anything reaching it, and a modality a
  producer introduces that reaches no accepting sink. A node taking part of a
  stream while another branch handles the rest is normal typed dataflow —
  intent is not inferable there, so it renders as structure and never carries
  a severity. Both checks are local in meaning (one producer port, one node),
  which is what keeps them unambiguous at any fan-out.
- **A model-backed node's real contract comes from its model, resolved before
  the graph analysis runs** (`app/pipelines/model_modalities.py`). The node
  class declares a `ModelModalityRule`: `follows_model` widens its `accepts`
  (an embedder reads whatever its model reads), otherwise the model must
  satisfy a fixed contract (a vision shell). Skipping the widening makes a
  multimodal embedding model still report its images as reaching no index. A
  provider publishing no modality list says nothing rather than "text only" —
  refusing those models would make most providers unusable for images. A gate
  predicting whether a run will *work* (`accepts_image_queries`) resolves that
  silence through `accepted_facets`, the helper the run uses — answering
  permissively there admits an image query the embedder then declines to
  embed, and the retriever fails on an item with no embedding.
- **Facet inference computes two bounds** (`app/pipelines/facets.py`):
  guarantees (every item has it) drive `requires`; potentials (any item might)
  drive modality analysis. A node's `adds` counts toward *guarantees* only
  when nothing can bypass it — either the arriving guarantee already shares a
  facet with `accepts`, or every facet that can arrive is accepted.
- **A node that rewrites an item's content declares `removes=(embedding,
  score)` on its output port and clears both on the items it rewrote**
  (`Item.without_derived_facets`). `preserves` asks whether these are the
  same items, `removes` asks which derived facets still describe them: a
  resize, a re-chunk, or a text write keeps an item's identity while
  invalidating the vector computed from the content it replaced, and a port
  claiming `embedding` afterwards hands the indexer a vector describing
  content that no longer exists. Clearing without declaring is as wrong as
  declaring without clearing — the graph then reads as sound while the run
  indexes nothing.
- **`removes` is subtracted only where the node can actually rewrite
  something**: from guarantees once any arriving item is processed, from
  potentials only when nothing can bypass. An image transform in a
  text-only stream rewrites nothing, so subtracting unconditionally would
  reject a graph in which every vector is still valid.
- **A node whose rewriting depends on its config answers `removes_for_node`
  rather than declaring it statically** (`app/pipelines/node.py`; the LLM
  shells share `removes_from_text_writes`). `validation.py` resolves it off
  the statically-resolved definition and projects it in `_graph_view`
  alongside the model-widened `accepts`. Declaring it statically would
  reject `embed → extract metadata → index`, where nothing is invalidated.
- **Every facet field a port declares must reach the wire**
  (`NodePortRead`). `accepts`/`unaccepted` decide whether `adds` and
  `removes` reach the whole stream, so a field the server keeps to itself
  leaves the editor's mirrored inference computing a different answer on
  every graph holding a restricted port.
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
  calls `handle.trace.mark_run_failed(exc)` — never hand-rolls the
  status/error/completed_at update.
- **Trace summaries preserve complete result identity.** Every item-producing node
  attaches a full ordered `ItemListTrace` for each relevant input/output port,
  including stable ids and scores, alongside its unchanged human-readable preview.
  Never truncate these identity lists or store derived effects: consumers need the
  complete lists to explain filtering, branches, merges, and reordering. A node's
  item list reflects the chunks that node actually emits: the embedding guard
  (`nodes/embedding.py`) may split an oversized chunk into several re-keyed,
  independently-indexed chunks, so its output list legitimately differs from the
  chunker's, and the trace shows the split.
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
- **Text a node on that path *writes into* items counts against the same
  limit, and a `replace` field takes the window over rather than extending
  it.** `app/pipelines/chunk_reach.py` carries each node's
  `max_output_tokens` (plus its separators) along the walk: a prepend/append
  accumulates on the chunker's window, so a window that fitted the model
  until a contextual-retrieval node was wired in stops reporting as fine,
  while a replace discards the chunk — from that node onward the chunker's
  size governs nothing, the node's own output is the base, and the finding is
  addressed to *its* `max_output_tokens` because changing `chunk_size` cannot
  fix it.
- **A node writing text with no declared budget is reported as unverifiable,
  never as zero.** A missing term silently turns an over-limit window into
  one that looks verified; for a replace nothing about the window is knowable
  at all, so no comparison is made and the unverifiable finding is the whole
  answer.
- **A node's declared budget must be enforced on the request that spends it.**
  `LlmEngine` sends `max_output_tokens` as the canonical `max_tokens`
  parameter — the window arithmetic above trusts that number, so a budget the
  model is free to ignore is worse than none, and a wire spelling
  (`max_output_tokens`, `num_predict`) is dropped in silence by the parameter
  filter.
- **The embedding guard repeats *both* affixes onto every part it splits an
  item into** (`app/pipelines/nodes/embedding_guard.py`, reading
  `Item.text_affixes`, which `llm/mapping.py` records on a `prepend` or an
  `append`). Splitting the whole text leaves the situating context on one end
  part and every other part carrying content with none of it — the exact
  inversion of what contextual retrieval is for, and invisible except as a
  chunk count that doubled. `prepend` and `append` are recorded and repeated
  together. The split budget subtracts both affixes so parts stay under
  the limit; affixes leaving too little room for content are not repeated,
  and the trace warning says which of the two happened.
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
  reserved variable name.** Reserving it means
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
- **`index_targets` lists every dense store the graph touches, not the primary
  one.** Purges iterate it (`app/pipelines/index_targets.py`), so a graph
  splitting its corpus across two indexes keeps the second one's vectors through
  every delete and re-serves removed documents on the next query. The scalar
  `backend`/`index_name` settings still describe the primary store.
- **Variadic input ports (`NodePort.accepts_many`) are the fan-in mechanism** — the
  executor collects every inbound edge into a list and the validator rejects
  multiple edges into a non-variadic port. Fusion
  nodes (`BaseFusionNode` + `fuse()` subclasses, `fusion.rrf` today) are built on
  it. **Default pipelines are hybrid** (dense + BM25, fused with RRF), scaffolding
  dense-only when the backend can't serve sparse indexes. **Purges iterate
  `settings.index_targets`** — deletion and re-ingest purges must cover every index
  a pipeline touches. Retriever nodes treat a not-yet-created index as zero matches
  (querying between setup and first ingest never 404s), and the BM25 branch
  degrades to empty with a warning when its name resolves to a dense index.

## The prompt library (`app/prompting/` + `app/services/prompts/`)

- **Every prompt in the app is a `Prompt` row; consumers store
  `{prompt_id, version|"latest"}` references, never raw text.** There is no
  detach-to-inline state: a one-off variant is a *fork* (new entity), because a
  detached string is invisible to the studio — no versions, no "used by", and it
  drifts silently from the prompt it copied. Historical pipeline versions keep
  inline text (history is immutable); everything current references.
- **One grammar, `{{variable}}`, strict at save and lenient at render.** Save-time
  validation rejects names outside the context's catalog
  (`app/prompting/catalogs.py`); run-time rendering leaves an unknown variable in
  place rather than failing a chat turn over a legacy row. Node-context rendering
  stays strict (an unavailable `{{query}}` on an ingestion run is an error with a
  reason, never a silent empty section).
- **Shipped prompts are read-only — editing forks** (`_ensure_editable`). Shipped
  rows only ever hold shipped versions, so a release appending an improved default
  (`seed_shipped_prompts`, which appends only bodies no existing version carries)
  can never shadow a user's edit; the edit lives on a fork, whose v1 may be the
  caller's draft (`PromptForkCreate.body`). Delete refuses too — seeding would
  resurrect the row on the next boot, so the delete would only ever look like it
  worked.
- **A shipped body that no release has published is edited in place; a published
  one gets a new version, and the bump rides the app's own version bump.** A
  prompt version is a thing users read, diff, and roll back to, so it should
  mark a change someone could have received — not every merge that reworded a
  default. `seed_shipped_prompts` appends whenever the spec body matches no
  existing version, so a pre-release edit creates an extra version on the next
  boot against a database still holding the old text — a local artifact; drop
  the row or ignore it.
- **A variable belongs to two places at once — `catalogs.py` declares it and
  `context.py` produces it — and renaming one side alone is silent.** Save-time
  validation reads the catalog while rendering reads the context, so a
  half-finished rename passes every save and then hands a live chat turn the
  raw `{{...}}` back. `test_every_chat_tool_variable_has_a_value_in_the_context`
  pins the pair. The names are backend-neutral for the same reason the product
  is: `collection.index.name` describes what a pgvector collection has too.
- **A node-context version's `output_fields` is the prompt's own schema; the node
  seeds from it but owns its copy.** Prompt text may float on `latest`, structure
  must not: a pipeline's downstream shape (metadata fields, filters) depends on
  the node's output fields, so runtime `prompt_refs` resolution fills only
  `prompt`/`system_prompt` and never rewrites the node's schema. Version-level
  validation reads the shell's allowed targets from `CONTEXT_TARGETS`
  (`app/pipelines/llm/validation.py`) — the one declaration the node shells use,
  so the two gates can't drift.
- **Node `prompt_ref`s resolve in `PipelineRunner.start` (after `$expr`
  resolution) and in `validate_pipeline_definition`**, via
  `app/pipelines/prompt_refs.py` — repositories only, since the engine may not
  import services. Runs record resolved `{node_id, prompt_id, version}` on
  `PipelineRun.prompt_versions` with `latest` pinned to the concrete version, so
  evals can attribute answer quality to prompt versions.
- **An LLM node whose templates reference nothing from the item it processes
  is a warning, not a pass.** Each shell declares its `payload_placeholders`
  (`{{text}}`, or `{{items}}` for the reranker); a template referencing none
  of them — and no `metadata.<key>`, which is per-item too — renders to the
  same string for every item, so the node pays for a model call each and
  writes one answer across the whole stream. Valid, expensive, and almost
  never intended.
- **An eval that varies a prompt version runs pipelines that pin it, never a
  run-time override** (`app/evals/comparison.py`). An eval result outlives the
  request that produced it, so a run whose behaviour is not written down in
  the definition it names cannot be read back later — each side gets a real
  copy of the pipeline with its `prompt_ref`s pinned, named after what it
  pins. This is the same rule as "a pipeline that must differ is a different
  pipeline"; a config override layer would reintroduce that invisible divergence.
- **The node-library endpoint rewrites preset prompt text onto the user's shipped
  prompt reference** (`app/services/prompts/preset_refs.py`) — a dropped preset
  reads the library rather than minting an inline copy that drifts from it.

## LLM pipeline nodes (`app/pipelines/llm/` + `nodes/llm_*.py`)

- **A shell whose per-item payload is media, not text, declares
  `carries_media` on its `ShellRules`** — the payload-placeholder warning
  otherwise fires on every vision prompt, which legitimately references no
  per-item variable because the image *is* the variable.
- **The `llm.*` nodes are thin facet shells over one engine; a new LLM method
  ships as a `NodePreset` (seeded config), never a new node type id.** Type
  ids are permanent wire contract; a preset is data — HyDE, contextual
  retrieval, and query expansion are prompts + output fields on an existing
  shell, and a per-method type would re-implement the same node under a name
  that can never be retired.
- **Model-request throttling is connection-scoped and holistic, enforced by
  the process-wide registry (`app/providers/throttle.py`) — never a
  per-node knob.** The connection is the thing being rate-limited:
  `ProviderResolver` hands out throttled embedder/reranker proxies
  (`app/providers/throttled.py`), bulk chat outside the LLM engine (eval
  generation) wraps the same way, and the engine slots its own calls against
  the same keys, so everything counts once. Interactive chat streaming is
  deliberately unthrottled — parking a user's turn behind a bulk run's
  exhausted window trades a retryable 429 for a stall nothing explains.
  Settings live on the connection config (`max_concurrent_requests`,
  `requests_per_minute`, plus advanced per-kind
  `embedding_/rerank_requests_per_minute` overrides) with starter-tier
  defaults on the adapters. Every kind draws from one shared window by
  default; a kind with its own pace (override or provider default) carves out
  into its own window, so a set override never multiplies the shared budget.
  RPM pacing runs inside a held concurrency slot so a full window never parks
  unbounded threads; a `None` pace is unpaced with 429 backoff as the reactive
  floor. `stamp_llm_throttle_defaults` writes the defaults onto existing
  connection rows at startup — key-presence idempotent, so a user's edit is
  never overwritten.
- **The engine's failure policy is classified by run kind
  (`context.document`): ingestion runs are strict, query-time runs degrade
  per item with a warning recorded in the trace.** A corpus where some
  chunks silently lack their transformation is an invisible quality bug; at
  query time a live answer beats an error.
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

## Evals (`app/evals/`)

- **Whether a sampled corpus document needs ingesting is decided by whether it
  reached the index, never by whether a row exists.** A failed ingestion leaves
  its document row behind, so a presence-only check reads it as done and skips
  it on every later run — one bad document is permanent for the eval
  collection's cache key and no run can repair it. `reached_the_index` and
  `DocumentRepository.list_unindexed_for_collection` own that question:
  provisioning re-attempts the unindexed documents each time it reuses a
  collection.
- **An eval collection is an ordinary `Collection` carrying
  `system_purpose="eval"`, so eval surfaces reuse the collection routes rather
  than minting parallel ones.** Only `list_for_user` hides it; every
  collection-scoped route already answers for it, and `POST
  /api/collections/{id}/files/retry-failed` is the one repair path both the
  Files page and the eval corpus panes call. A second endpoint over the same
  rows drifts from the first the moment either changes.

