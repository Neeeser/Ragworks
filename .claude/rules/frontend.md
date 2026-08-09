---
paths:
  - "frontend/**"
---

# Frontend Engineering Practices

Rules for working in `frontend/` (Next.js App Router + React 19 + TypeScript). The
core idea: **small, component-driven, well-named files that one person can hold in
their head at once.** Repo-wide rules in the root `CLAUDE.md` apply here too.

**Any UI work loads the `ragworks-ui-design` skill first** — it is the design system
(tokens, composition, motion, data display), and it is where design decisions the user
clarifies get recorded so every screen keeps making the same ones.

## The gate

**`npm run verify` (typecheck → lint → tests) must pass before every commit.** All
three stages are errors-fail. Lint enforces the structural rules mechanically:
`max-lines` 400 (production code), `no-console` (warn/error allowed),
`react-hooks/exhaustive-deps` as error, `import/no-duplicates`, `import/no-cycle`.
`complexity`/`max-depth` warn — treat a new warning in your diff as a design
prompt. Run lint via `npm run lint`, never bare `npx eslint` — the script
carries the `--cache` flags, and a bare invocation re-lints the whole tree
cold (minutes instead of seconds). The `react-hooks/set-state-in-effect` override for six grandfathered
hooks is a burn-down list — never add a file to it. Do not add `eslint-disable`
without a comment saying why, and never disable `max-lines` — split the file.

## Layout — where code goes

```
src/
  app/             Next.js App Router routes — thin shells only
    (console)/     authed console routes (chat, collections, pipelines, …)
    auth/          login/signup routes
  components/      feature folders (chat-studio/, collections/, pipelines/, …)
    <feature>/     components at the root, pure modules in lib/, hooks in hooks/
    ui/            shared primitives (ModalOverlay, Field, Button, WizardShell, …)
  lib/
    api/           the ONLY place network calls live (domain modules + apiFetch)
    types/         wire types by domain, hand-mirrored from app/schemas
    *.ts           shared pure helpers (errors, format, use-api-query, …)
  providers/       React context providers
  test/            setup, centralized mocks (mocks.ts), fixtures (fixtures/)
```

New code goes in the feature folder that owns it. Promote to `components/ui/` or
`lib/` only on second use (see Duplication). A single-file folder isn't a feature —
colocate the file with its only consumer.

**Anything round in a `TrendChart` is drawn against the plot's measured scale, never
as a bare `<circle>`.** The plot renders `preserveAspectRatio="none"`, so the two axes
stretch by different factors and a circle comes out a lozenge — a chart of
measurements drawn as lozenges reads as a rendering fault rather than data. `usePlotScale` + the `Dot` helper in `trend-chart/layers.tsx`
express radius per axis; new marks use them.

**A latency band is drawn only where a bucket holds ≥2 samples.** One measurement has
no distribution — its p50 and p95 are both that measurement — so shading it inflates
a single slow query into a wedge of variance nobody recorded; the event dot already
records it.

**Events carry their own timestamp, so they position at a fractional bucket index.**
Series values plot at bucket _starts_, which leaves the final tick one bucket short of
the domain end; anything inside that last bucket must clamp onto the tick rather than
be dropped, or the chart silently hides the most recent activity.

**Trace value displays are a registry, not a switch.** Pipeline trace inputs/outputs
render through `components/traces/values/`: an ordered `{ match, Component }`
registry picks the most specific view per value by _shape_ (`shape-guards.ts`), with
a normalized-JSON fallback last. A new node's payload gets a polished display by
adding one renderer entry + guard — never by branching inside the IO blocks. Every
view caps its own height and scrolls internally so a large value can't reflow the
viewer.

**A node explanation renders its produced-nothing outcome, and never returns
`null`.** The explanation panel has no fallback of its own, so a renderer that
bails when a summary is empty paints an empty panel exactly where the user is
asking why a step produced nothing — state the outcome, and read it from the
node's summary rather than inferring a cause the trace does not record (a parse
node emitting no items declined the file or read it and found nothing, told
apart only by its `Unread files` value).

**`skipped` is a display-only node status, derived from the parse node's own
summary** (`components/traces/lib/node-status.ts`, `NodeDisplayStatus`).
Declining a file is a parse node's contract in a fan-out, so the backend
records `completed` — but a green Done on the branch that read nothing claims
the file went through it, so the trace surfaces derive the skip client-side
and never expect it on the wire.

**Focused trace results stay renderer-driven.** Item-capable value renderers accept
the optional `focusedItemId`/`onFocusItem` contract, preserve and pin the focused
row with its node-local rank and score, and explain effects in that value's
vocabulary. Journeys derive effects client-side from complete item lists; never
store effects or add tracer-wide node-type conditionals, because new node types
participate through their summary values and registry renderer. Keep identity-only
values hidden until focus mode so the ordinary run inspector remains unchanged,
and model every index target in combined graphs so hybrid branch paths do not end
at the first store.

**The combined end-to-end graph carries non-`PipelineNodeData` nodes — never
assume `data.inputs`/`data.outputs` exists.** The index store joining the
ingestion and retrieval bands is `IndexStoreNodeData` (no port arrays) and sits on
the index read/write edges. Layout/timing helpers that read `data.inputs.length`
or `data.outputs.length` must tolerate their absence — an unguarded read crashes
the whole end-to-end trace, and it's reachable on every hybrid document trace
since default pipelines draw a store.

**File previews are a matcher list, not an if-ladder.** The Files page resolves a
preview renderer per file through `components/files/lib/preview.ts`: an ordered list
of `{kind, types, typePrefix, extensions}` matchers (content type first, extension
fallback). A new previewable type is one matcher entry plus a branch in
`FilePreviewContent` — and only _safe_ renderers: HTML renders as source and SVG
only through `<img>`, never live; anything unmatched gets the metadata card +
download, never a faked preview. Preview bytes are fetched authenticated via
`fetchFileBlob` → object URL (media elements can't send an Authorization header);
the content component is keyed by node id so it remounts into its loading state.
Never nest a `<button>` in a tile/row containing the `IngestionBadge` — its retry X
is itself a button (invalid HTML that hydrates unpredictably); use a
`role="button"` div with keyboard activation like `FileGridView`.

**A virtualized row's root element must carry a literal `data-index={item.index}`
alongside `ref={virtualizer.measureElement}`.** `@tanstack/virtual-core` resolves
which item it just measured by reading that attribute back off the DOM node
(`indexAttribute: "data-index"`), not from closure state — an element missing it
silently measures as index `-1`, and rows overlap or jump. `FileVirtualRows`
(`components/files/FileVirtualRows.tsx`) is the reference: it also proves that a
row's separator can't use CSS `:last-child` (only rows near the viewport are
mounted, so the last DOM child is a scroll-position accident, not the collection's
true last entry — compare by index instead). Any test rendering a virtualized list
under jsdom needs the scroll container's `offsetHeight` stubbed
(`src/test/virtualized-list.ts`) or the list renders nothing at all, regardless of
item count: `@tanstack/virtual-core` treats a zero-height viewport as no viewport.

**A virtualized row whose content changes shape after mount (an async fetch, a
disclosure toggling) must trigger its own remeasure — `ResizeObserver` alone is not
a sufficient trigger.** Its notifications are delivered as part of the browser's
rendering pipeline, which is throttled or skipped entirely for a document not
currently visible to the compositor — a backgrounded tab, or (verified live) this
app's own sandboxed/automated browser sessions — so a row can genuinely grow
(`getBoundingClientRect` proves it) while every row after it stays laid out at the
stale size, visibly overlapping. `VirtualFileRow`
(`components/files/VirtualFileRow.tsx`) fires an explicit `useLayoutEffect`-driven
remeasure on every known shape change (`expanded` toggling, plus `onContentResize`
threaded into `FileRowDetails` for its async chunk fetch settling) instead of
waiting on that pipeline. That remeasure calls `virtualizer.resizeItem(index, size)`
directly, never `virtualizer.measureElement(node)` a second time: `measureElement`'s
own default implementation short-circuits to whatever size is _already cached_
whenever it runs without a real `ResizeObserverEntry` — true for every call after
the first mount — so calling it again silently returns the stale height instead of
reading the DOM. A test that manually fires a fake `ResizeObserver` notification to
prove this proves nothing: it bypasses the exact step (the pipeline never firing)
that breaks in a real browser — drive the real interaction instead.

## Adding a feature end-to-end

The expected shape, in order:

1. **Types** — add/extend wire types in `src/lib/types/<domain>.ts`, matching the
   backend schema in `app/schemas/` (check it — don't guess the shape).
2. **API module** — the typed function in the right `src/lib/api/<domain>` module,
   through `apiFetch`, `token` first. No `fetch()` anywhere else.
3. **Hook** — a custom hook owning the state domain (data loading via
   `useApiQuery`, mutations with error/success channels). Complex state gets a pure
   `*-reducer.ts` with its own tests.
4. **Component** — renders from the hook's API, built on `components/ui` primitives.
5. **Page** — the route file under `app/` composes the component; no logic in it.
6. **Tests** — behavior tests for reducer/hook logic and the key user-visible
   flows, using `src/test/mocks.ts` and `src/test/fixtures/` — never hand-rolled
   mocks.
7. **Browser verification** — test in a seeded sandbox scenario, never a
   hand-built state, and harden what you validated into a saved flow
   (`frontend/flows/<scenario>/`) in the same PR — see `.claude/rules/sandbox.md`.
   **Verify every touched surface in both viewports — desktop (≥1280px) and
   mobile (375×812) — switching and screenshotting one right after the other**
   so the two states are compared in the same pass, not from memory. This is
   primarily a desktop app and density decisions are made at desktop width,
   but a view that is broken or unusable on a phone is a bug: side panes must
   become overlays, toolbars wrap, nothing needs horizontal page scroll, and
   navigation is the bottom tab bar (`MobileNavBar`) below `lg`.

Chat Studio (`components/chat-studio/`) is the reference implementation of this
shape. Then run the gate (`npm run verify`).

## Fixing a bug

Follow the root rule: regression test in the same commit, verified red-green.
Reproduce at the lowest level that exhibits the bug (pure `lib/` function or
reducer, then hook, then component) and watch it fail for the bug's reason. If the
bug teaches a reusable rule, add one line to the relevant section of this file in
the same PR.

## Code structure

- **File size is a design signal.** Components and hooks stay under ~300 lines; 400
  is the hard lint ceiling (tests exempt). A file approaching the limit has more
  than one responsibility — split it.
- **One responsibility per file.** A component renders; a hook owns one state
  domain; a `*-utils.ts` module holds pure functions. If you can't name the file
  after its single job, it has more than one.
- **Logic lives in hooks, not components.** When a component accumulates fetch
  effects, handler groups, or derived-state chains, extract a custom hook per state
  domain; the component composes hooks and renders.
- **Reducers over state constellations.** More than ~5 related `useState` calls
  that update together, or any ref that exists only to mirror state for closures,
  means `useReducer` with named actions. Copy-pasting a "reset all these states"
  block is the classic symptom.
- **Pages are thin shells.** Route files under `app/` delegate to
  components/hooks; no business logic or fetch orchestration in a `page.tsx`.
- **Edge routes are computed synchronously in a pre-paint microtask, never via
  an async transport.** A Worker roundtrip (or any compute crossing a paint)
  makes the graph paint native step paths first and shift to routes a beat
  later — visible on every mount and README/landing scene switch. Routing only
  runs on discrete geometry commits (mount, drop, tidy, add/remove), so
  main-thread cost is a few ms at those moments — never move it behind a worker
  or any other async boundary.
- **While a node drags, routing freezes instead of blanking.** The provider
  holds its pre-drag geometry and submits nothing until drop, so per-edge
  signature matching keeps every unmoved edge on its exact routed path; only
  the dragged node's own wires fall back to the native step path that follows
  the cursor. Suppressing all routes during drag flips the whole graph at grab;
  publishing mid-drag routes flips the wire on frames where the cursor pauses.
  Both stay fixed only if no route is ever computed against mid-drag geometry.
- **A route's committed shape must equal the native drag fallback wherever no
  obstacle forces a detour.** `edge-route-refinement.ts` canonicalizes every
  monotone, collision-free route to one midpoint right-angle jog — the same
  shape `getSmoothStepPath` draws mid-drag — so grab/drop doesn't flip the
  wire between two valid layouts, and near-aligned ports don't render the
  grid router's crammed micro-jog squiggle. Blocked corridors keep the
  router's node-avoiding path.
- **A canvas offset in node units is applied after `screenToFlowPosition`,
  never before.** Node sizes are flow units and pointer coordinates are screen
  pixels, so subtracting half a card from the screen point scales the
  correction by the zoom — a dropped node lands further from the cursor the
  further out the canvas is zoomed, and looks correct at zoom 1.
- **Shared downstream nodes sit between parallel branch rows.** In a hybrid
  pipeline graph, center a merge/output node vertically between its inputs so
  smooth-step edges don't route through either branch's node card.
- **The create-pipeline wizard's tool graphs are built by the server
  (`GET/POST /api/pipelines/tool-templates`), never assembled in TypeScript.**
  Port keys and node ids belong to the Python node registry, so a graph
  written here drifts from it silently and is rejected only when a user clicks
  Create. The ingestion scaffold (`pipeline-scaffold.ts`) is the one exception
  — its intake presets have no server-side equivalent — and its edges name the
  shared `PORT_ITEMS` constant rather than a hand-typed handle id.
- **Feature folders separate components from logic.** Components at the folder
  root, pure non-React modules in `lib/`, hooks in `hooks/` — grouped into domain
  subdirectories once they outgrow ~10 files. Chat Studio is the reference
  decomposition: a ~390-line orchestrator composing single-domain hooks plus a pure
  reducer module with focused tests. New features add a hook or extend the reducer
  — don't grow the orchestrator.
- **Reducers live in pure modules.** State shape, action types, and the reducer
  function go in a plain `*-reducer.ts` with no React imports so they're
  unit-testable; the hook file owns only `useReducer` wiring, refs, and the exposed
  API.
- **Group props by domain, not by count.** Past ~10 props, group related props into
  typed objects built with `useMemo`. A huge prop interface is a smell that the
  parent owns state the child's hooks should own.
- **Read `useCssTokens`' result as one array; never destructure it.** It returns
  state, so the array keeps its identity until the palette actually changes —
  `const [a, ...rest] = useCssTokens(…)` builds a fresh `rest` every render, and
  any memo keyed on it recomputes forever. On a canvas that rebuilds every
  deck.gl layer per render, which no test notices because the output is correct.
- **`React.memo` only works with stable props.** Every object/callback prop a
  memoized child receives must come from `useMemo`/`useCallback` — one inline
  literal defeats the memo. During streaming this is the difference between
  re-rendering a timeline and re-rendering the entire page per token.
- **Hydration-safe initializers.** Never read
  `localStorage`/`sessionStorage`/`window.*` inside a `useState` initializer — the
  server render uses different values and hydration mismatches. Initialize with the
  default, hydrate in a mount effect, and gate any effect that reacts to the
  hydrated value behind a `hydrated` flag.
- **A `setState` updater function is pure — never notify a parent from inside one.**
  React invokes updaters during the render phase whenever it can't evaluate them
  eagerly, and under StrictMode (the dev server's default) it does so on every
  update — so a parent `setState` in there is a set-state-in-render error and fires
  more than once. Compute the next value in the handler, set it, then report it.
- **Effects must not write state they derive.** Computing a value in `useMemo` and
  copying it into `useState` via an effect adds a render per change and a stale
  window. Derive it where you use it.
- **After a mutation, apply the response — don't immediately refetch.** The
  backend's request session commits at dependency teardown, after the response
  is sent, so a GET fired the instant a POST resolves can read the pre-write
  state and quietly revert the UI. Mutation endpoints return the updated
  entity; fold that into state, and let any list refetch be cosmetic.
- **Background refetches must be invisible to in-progress work.** The auth
  provider rotates the token every 12 minutes, re-running every data effect
  keyed on it — a reload must preserve the user's selection (re-find by id, not
  reset to `[0]`), return previous identities for unchanged content, and not
  flip `loading`. A fresh `nodeSpecs` identity re-fires the canvas-seeding
  effect and silently wipes unsaved pipeline edits.
- **A deep-link query param is a one-shot intent: consume it once and let it beat
  persisted defaults.** Seeding state from a `?param=` in a mount-time initializer
  and seeding the same state from last-used/session settings when an async load
  resolves is a race the persisted value usually wins — and per-user persistence
  then masks it, because the second visit looks correct. Read the param once, spend
  it at the seeding site, and never re-apply it afterwards (re-applying resurrects
  it over a change the user made after load).
- **Read a repeatable query key with `getAll`, not `get`.** `get` returns only the
  first value, so `?ids=a&ids=b` silently drops everything after `a`.
- **A pane's state-dependent default is derived at render, never stored.** Computing
  "open unless the user closed it" as `stored || (condition && !dismissed)` cannot get
  stuck; writing that default into the pane's own state through an effect re-fires on
  every background refetch, so the pane springs open under a user who closed it and
  stays open after the condition it existed for is gone. Latching the default into state
  during render has the same failure with a worse shape — it latches on the render where
  async data has not landed yet, and nothing unlatches it.
- **Worker-backed providers own their full teardown.** On unmount, terminate the
  worker, cancel in-flight and pending work, and make already-queued microtasks
  no-op so tests and route transitions cannot retain stale background work.
- **When replacing an effect, enumerate every ordering it handled.** A reactive
  effect re-fires when async data arrives; a click handler runs once — converting
  one to the other silently drops the "data resolved after the interaction" path
  — a data-loss bug. For seed/sync logic, prefer a
  render-time state adjustment guarded so it fires only when the target is still
  empty _and_ the seed is non-empty (the second guard prevents an infinite
  setState loop).
- **`overflow-hidden` on a flex-column child needs `shrink-0`.** `overflow: hidden`
  zeroes the item's automatic minimum size, so inside a scrolling flex column the
  panel silently collapses to its borders once a long sibling overflows the column —
  data-dependent, so it passes every test and short-list manual check and only
  appears for users with enough rows. Deliberate
  full-height panes (`min-h-0 flex-1`) are the only children allowed to shrink.
- **A flex/grid item holding arbitrary content carries `min-w-0`.** Its automatic
  minimum size is the widest non-wrapping descendant — one `truncate` row (a model
  name, a file path) sizes the column past its container, and a clipping ancestor
  (a dialog panel) cuts the content off the right edge instead of shrinking it.
  Visible only at narrow widths and only with long enough data, so nothing in the
  gate sees it.
- **A `min-w-0` cell beside fixed-width columns reaches zero width before the columns
  give up any.** `min-w-0` removes the floor, so on a phone the row's name cell
  disappears and a `whitespace-nowrap` label inside it overflows across the next
  column, printing two labels on one another. `DataRow` wraps its columns onto their
  own line below `sm`; any row-like layout needs the same wrap plus phone-sized column
  widths, and any nowrap label in a shrinking cell needs `truncate`.
- **Delete dead code on sight.** No-op callbacks drilled through props,
  "convenience" re-export blocks, helpers wrapping a single operator — remove them.
  Dead code costs every future reader.
- **A control character in source is written as an escape (`\u0000`), never as a raw
  byte.** Webpack's dev chunks wrap each module in `eval("…")`, and SWC emits a raw
  source byte as a `\u0000` escape _inside that outer string_ — so `eval` hands the
  parser a literal control character. V8 tolerates it, SpiderMonkey aborts the script
  ("literal not terminated before end of script") and every route whose chunk includes
  the module dies in Firefox only. Nothing else in the gate sees it: esbuild, vitest,
  tsc, and Prettier all accept the raw byte, which is why
  `src/lib/__tests__/source-hygiene.test.ts` scans for it.

## Duplication

- **Second copy = extract.** The moment you paste a function, class-string,
  constant, or JSX block into a second file, extract it to the shared layer it
  belongs to (`lib/`, `components/ui/`, or the feature's `*-utils.ts`) — copies
  multiply and drift until one of them is a bug.
- **Derive, don't duplicate types.** When one type is a subset/variant of another,
  derive it (`Extract`/`Omit`/`Pick`) instead of maintaining a parallel interface
  that will drift.
- **Constants are defined once.** Sentinel strings, size constants, and default
  flags live in one exported constant; a second definition that "must stay in sync"
  is a latent bug.
- **UI state lives in the component that uses it.** Search terms, sort orders, and
  other view-local state belong in the component or its own hook — not lifted to a
  parent that just drills them back down. (Exception: state that must survive
  unmounting genuinely belongs to the parent.)
- **Library monkey-patches are quarantined.** If a prototype patch is truly
  unavoidable, it lives in its own `*-patches.ts` module with an idempotence guard
  and a comment explaining why — never inline in a component file.

## TypeScript

- **`npm run typecheck` must exit 0 before every commit** (first stage of the
  gate). Unchecked type errors accumulate silently, and some of them are runtime
  crashes.
- **Never suppress:** no `any`, no `@ts-ignore`, no `@ts-expect-error` in source.
  Fix the type. An `as` cast is a last resort for invariants the type system can't
  express — keep it local and comment why.
- **Narrow, don't cast.** Use type guards (`typeof`, `"field" in obj`, discriminant
  checks) to handle unions. Casting through `unknown` hides real mismatches.
- **Learn the library's generics.** `@xyflow/react` v12 takes the full node type
  (`NodeProps<Node<PipelineNodeData>>`), not the data type; `new Map(entries)`
  needs `[K, V]` tuples. When a library upgrade changes generics, fix the usage —
  don't cast around it.
- **Types are organized by domain** in `src/lib/types/` with an `index.ts` barrel.
  They hand-mirror the FastAPI schemas; if a shape is uncertain, check the backend
  schema instead of adding a `[key: string]: unknown` escape hatch.

## API layer

- **Every network call goes through `src/lib/api/`** — domain modules behind the
  `@/lib/api` barrel, all funneling through `apiFetch` in `client.ts`. No stray
  `fetch()` outside this layer.
- **`token` is always the first parameter** of an authed API function. Mixed orders
  with same-typed adjacent params produce swaps the compiler can't catch.
- **Errors are typed.** `apiFetch` throws `ApiError { status, detail }`; use
  `isUnauthorized(err)` for 401s and `getErrorMessage(err, fallback)` to display
  messages. Never write the `err instanceof Error ? err.message : "…"` ternary
  inline — it proliferates by copy-paste.
- **`"use client"` belongs on components/hooks only** — never on plain `lib/`
  modules; it forecloses server-side use for no benefit.
- **A URL the _user_ must reach is built from `API_BASE_URL`, not the page
  origin.** The two are the same only in Docker (same-origin `/api/*` proxy); in
  dev the frontend and backend are different ports, so showing
  `window.location.origin` hands the user a URL nothing answers on.
  `mcpEndpointUrl` takes both and prefers the API base. Read the browser origin
  through `useOrigin()` (`src/lib/use-origin.ts`), which gives React a server
  snapshot instead of a state-plus-effect hydration dance.
- **Only a registered index is selectable.** `useIndexes` derives
  `registeredIndexes`/`unregisteredIndexes` from one fetch — pickers offer the
  registered set, the index registry shows both so an index created outside the app
  is visible rather than hidden. Never add a second hook that re-fetches the list.
- **A suggested default that names a shared backend resource is derived per
  account, never a fixed literal.** A pgvector index name is one physical table
  for the whole deployment, so one default hands every account the same store —
  their vectors interleave where neither can see the other. Build the name from the account and the backend's own
  `index_name_max_length`, leaving room for the `-bm25` sibling.
- **A control that changes which index a pipeline targets states the consequence
  before the change.** Switching indexes moves no data, so the collection reads an
  empty store until it is re-ingested — and that outcome is invisible at query
  time, because retrieval just returns nothing.
- **A store-bound node's index field states where the index comes from — named
  on the node, or held by a pipeline variable — and picking a source never
  rewrites config on its own.** Writing on the toggle discards the index the
  node names before the user has said what replaces it, and that literal is
  exactly what a new variable is built from. Leaving a variable must clear the
  expression off _every_ identity field it wrote (`backend` as well as
  `index_name`), or the node keeps reading a variable it no longer names.
- **No collection surface changes an index.** A collection page states where its
  data lives and links to the pipeline that decided it. Which index a pipeline
  uses is the pipeline's decision; a collection that needs a different store
  needs a different pipeline — the catalog's copy action.
- **A template and its rendering are one surface with two toggles, not two
  columns.** The prompt studio shows each template once at full width and
  switches how it reads on two independent axes: `Source ⇄ Rendered` (editable
  markdown, or the formatted result) and `Names ⇄ Values` (`{{text}}` literal,
  or an atomic chip carrying its sample value). A side-by-side preview pane
  differs from its source only where a variable appears, so it spends half the
  page duplicating text. Rendered is required: a prompt author needs the
  formatting the model receives, which syntax highlighting alone never shows.
- **Rendered is read-only, and says so.** Formatted markdown needs a renderer;
  the value chips need the editor — they cannot share a box. So Rendered
  labels itself a preview rather than silently swallowing keystrokes, and any
  panel-level control (full screen) lives outside the editor's own toolbar, or
  it disappears with it and strands the user.
- **A variable's sample value is session state, never part of a version.** It
  is the corpus you are tuning against, not the template, and two people
  editing one prompt test it on different data — so it is excluded from
  "unsaved changes" and survives switching prompts. It reaches the render
  preview and the test run (`values` on both endpoints); a bench that can only
  exercise the catalog's stock examples answers "is this prompt well-formed",
  never "does this prompt work on my data".
- **An inner-loop editor opens over the work, never instead of it.** Tuning a
  node's prompt is edit-test-edit, so `PromptStudioOverlay` mounts the studio
  above the canvas rather than navigating to `/prompts`: a route change there
  costs the user their unsaved graph and their place. Anything that creates a
  new entity from inside such an overlay reports it back (`onForked`) so the
  caller repoints — a fork nothing was repointed at is an edit that silently
  does nothing.
- **A check that writes server-side state is a mutation: report it so the list
  refetches.** Validating a connection stamps `last_validated_at`, which the
  capability gates read — a row that only keeps the result locally turns green
  while every picker still treats it as never reached. The same probe against
  *unsaved* edits stamps nothing, so it must not report one.
- **A picker that repoints at something it just created must refetch its
  options.** The new entity postdates the list, so the control holds an id it
  cannot name and renders blank over a perfectly valid reference.
- **Every model choice renders one of two shared components — there is no third
  way to pick a model.** A pane gets `ModelPickerInline`; a form row gets
  `ModelPickerField`, a trigger showing the selected model that opens the same
  `ModelBrowserOverlay`. A bare `CustomSelect` over a catalog is what reduces a
  model to a name-and-connection string with no capabilities, no search across
  providers, and no pins, so it is never the answer for a model — only for short
  enumerations (variable types, backends).
- **`ModelPickerInline` puts the models a user works with before the catalog.** The picker opens on Pinned, else Recent, else All,
  so a returning user picks from a handful and a brand-new account still lands
  on a searchable list rather than an empty section. A surface that renders its
  own list of models re-derives the shortlist, the drawers, and the capability
  marks, and drifts from the shared one the first time either changes.
- **A surface's own facts about a model go through `annotate`, not a forked
  row.** The setup wizard's "Suggested" marker and its over-the-pgvector-cap
  warning are per-model annotations the catalog cannot know; they ride on
  `ModelRow`'s badge and note slots, with `prioritizedModelId` floating a
  recommendation to the top of the list.
- **Catalog narrowing is by capability** — "the models that read images and
  call tools" is the question users ask. Chips are offered only for
  capabilities present in the loaded catalog, so a chip is never a dead
  control advertising something no connected provider serves. Provider filter
  and sort stay available beside them.
- **A provider's models group into collapsible drawers with counts.** One
  connection publishing three hundred models otherwise pushes every other
  provider below the fold; a search auto-expands the drawers holding matches
  and names the providers with none, because a provider silently missing from
  the list reads as a broken connection.
- **A per-connection failure renders against that connection, never over the
  surface it appears on.** `connection_errors` entries become an
  `UnreachableProviderNotice` in the catalog list (leading it, since a provider
  publishing hundreds of models buries anything below), and on a shortlist tab
  only when they explain an entry that could not resolve; `modelsError` stays
  for a failure of the whole request. A banner over the picker blames every
  provider for one being down, and a connection whose failure is only shown
  inside a picker is invisible to the user whose pipelines are bound to it —
  so Settings states it on the connection's row and the overview carries one
  row per dead connection, all read from the same catalogs
  (`useProviderReachability`) so no surface can disagree with another.
- **Capability marks are additive claims, never denials.** Text is the baseline
  and is not badged; a mark appears only where a provider stated the capability
  (`lib/model-capabilities.ts`). Absence means "not stated" — rendering it as
  "cannot" makes a provider that publishes no capability tree look less capable
  than one that does.
- **An icon next to its own visible label is `decorative`.** `CapabilityIcon`
  otherwise carries a tooltip and an `sr-only` name, so a chip that also prints
  the label announces it twice ("Tool callingTool calling").
- **The connection form renders every field kind from the catalog.**
  `ConnectionConfigFields` dispatches on `field.kind` (`string`/`secret`/`url`/
  `boolean`/`select`) and hides `advanced` fields behind a disclosure, so a new
  provider type costs zero form code. A `boolean` stores `"true"`/`"false"` —
  the JSON spellings the backend round-trips — never `String(bool)`.
- **A discovery probe pre-fills the form; it never saves on the user's behalf.**
  The user is the one who knows their server, so a probe that missed a
  capability is corrected in place. When the probe reports it was refused
  (`unauthorized`), report that through the _error_ channel and leave the
  toggles alone: every surface answers 401 on a bad key, so writing that
  "nothing" into the form clears capabilities over a problem in the key field.
- **Admin settings render from the config catalog, not per-field forms.**
  `AdminSettingsPage` fetches `GET /api/admin/config` and renders one
  `ConfigFieldControl` per entry, dispatched on `field.kind` — a new backend config
  field needs no new frontend form code, only the `PublicConfig` mirror in
  `src/lib/types/config.ts` if it's public. Env-pinned fields render disabled with
  a "Pinned by {env_var}" badge instead of a save control.

## Data fetching in components

- **Use `useApiQuery(fn, deps)`** (`src/lib/use-api-query.ts`) for load-on-mount /
  reload-on-change data. It owns the loading/error/cancellation lifecycle. Don't
  hand-roll the `useEffect` + `cancelled` flag + `setLoading/setError/setData`
  dance — hand-rolled copies drift, and the ones that forget the guard are race bugs.
- **A `useApiQuery` is keyed on what the endpoint reads, not on the resource's
  id.** `GET /collections/{id}/indexes` derives its answer from the collection's
  bound pipelines, so deps of `[token, collection.id]` never refetch when a
  binding changes and the card shows the previous pipeline's indexes until a
  full page reload. Key on a string built from the fields the answer depends on
  (a dep array must keep its length, so join them).
- **The pipeline editor validates against the server on a debounce, including
  the open drawer's uncommitted draft** (`hooks/use-live-validation.ts`). Server
  rules — embedding input limits, backend compatibility, expression taint — are
  otherwise reachable only by saving, so a field can be wrong for a whole
  session without saying so. The draft is held in `useNodeEditing`, never merged
  into `nodes`: merging re-renders the canvas on every keystroke in a text box.
  A failed request leaves the previous issues in place rather than reporting an
  empty list, which would claim the graph became clean.
- **Never swallow a fetch error.** Every failure surfaces to the user through the
  component's error channel. A `.catch` that only flips a boolean, or a
  `try/finally` with no `catch`, silently hides the failure from the user.
  A success and a failure never share one message slot: rendered in the same
  neutral body text, a refusal reads as confirmation and the user walks away
  believing the change landed.
- **Public runtime config comes from `useAppConfig()`**
  (`src/providers/config-provider.tsx`), never a one-off `fetchPublicConfig()` —
  the provider fetches once and keeps `DEFAULT_PUBLIC_CONFIG` (permissive) as the
  value until the fetch resolves and as the fallback if it fails, so the UI never
  blocks on the config service. Feature-gated UI checks flags against an explicit
  `=== false` / `!== false`, not truthiness, so the permissive default and the
  loading window never flash a feature off before the real value arrives.

## UI primitives — use them, don't re-roll them

- **Every overlay is `ModalOverlay`** (`components/ui/modal-overlay.tsx`). Never
  hand-roll a `fixed inset-0 z-50` div — hand-rolled overlays diverge on
  Escape/backdrop/focus behavior and drop `role="dialog"`. ModalOverlay owns
  Escape-to-close, backdrop click, focus management, Tab containment, scroll lock,
  and ARIA wiring; dialogs pass `labelledBy`. It portals to `document.body`: an
  ancestor's transform creates a stacking context, and a non-portaled overlay's
  `z-50` loses to the sticky `z-30` navbar.
- **Every checkbox is `Checkbox` (labelled) or `CheckboxBox` (the control alone,
  when the caller owns its row markup)** — `components/ui/checkbox.tsx`, swept by
  its own test. A bare `<input type="checkbox">` styled with `accent-color` plus
  any custom background or border loses the browser's own paint path, and with it
  the checkmark: the box then looks identical checked and unchecked. The primitive
  draws the glyph itself and keeps it at full contrast when disabled, so a
  checked-but-locked option doesn't read as unset.
- **Every form control goes through `Field`/`TextInput`/`Select`/`TextArea`**
  (`components/ui/field.tsx`) — Field wires `htmlFor`/`id` and `aria-describedby`.
  Canonical input styling is the exported `inputClass` constant — never hand-type
  `rounded-2xl border border-white/10` into a form control.
- **Product-facing dropdown selection uses `CustomSelect`**, never a browser-native
  `<select>` whose popup cannot follow the product theme. The shared primitive owns
  popup styling, keyboard/typeahead behavior, focus management, and portal
  positioning. Use a native control only when platform-native behavior is
  deliberately required, and document that reason next to the control.
- **Confirmations use `ConfirmDialog`**, including destructive type-to-confirm
  flows via `confirmText` — no bespoke nested delete modals.
- **Wizards use `WizardShell` + `WizardFooter`** — the Back/Next/Cancel cluster is
  one component, not per-wizard JSX. The shell caps itself at the viewport and
  scrolls only the step body, so a tall step never pushes the footer off screen.
  **A step's requirement gates the step list as well as Next**
  (`maxReachableStepIndex`): gating only the button leaves the sidebar as a way
  to click straight past a required field, and the wizard then submits without
  it.
  **What a wizard suggests follows the choice it describes.** A suggested name
  or model derived from the selected template or index re-seeds when that
  selection changes, until the user supplies their own — a suggestion left
  behind creates an entity named after, or embedding for, something it isn't.
- **A popover opened inside a scrolling panel must portal to `document.body` and
  position from the trigger's viewport rect.** An absolutely-positioned one is
  clipped by the panel's `overflow-y-auto` — the list renders but its options are
  unreachable, and only at the sizes where the panel actually scrolls.
  `ModalOverlay` already expects portaled popups (its backdrop-click check reads
  pointerdown in the capture phase), so a portaled listbox works inside a dialog.
- **`Button loading` keeps its children visible** (spinner + `aria-busy` +
  disabled). Never swap button content for placeholder text; it causes layout shift
  and breaks accessible names.
- **Nested dialogs: Escape closes only the topmost.** ModalOverlay's internal
  overlay stack gives you this for free; preserve the one-layer-per-Escape
  convention.
- **An action that can be refused opens its own surface and states the refusal
  there.** Writing the reason into the page's transient notice and returning
  leaves a button that visibly does nothing — that notice carries no alert role
  and dismisses itself after a few seconds. `SaveVersionDialog` opens on the
  blocking findings, gathered from both validators (`collectSaveBlockers`:
  client `nodeErrors` plus the live server pass) and attributed to the node each
  one names; a gate reading only the client checks lets graph-level errors
  through to a save that then fails.
- **Clear stale feedback at the start of each attempt.** A retryable action clears
  its error AND success channels at the top of every attempt — otherwise a stale
  "failed" banner survives next to a fresh success message. When a handler moves
  into a hook, the hook owns this reset (e.g. an `onCreateStart` callback).
- **`cn` resolves Tailwind conflicts via `tailwind-merge`** — a later class
  deterministically wins. Don't rely on stylesheet order, and don't use `cn` for
  non-class strings (joining ARIA id lists — use a plain join).
- **Every custom `@theme` scale is declared to tailwind-merge in
  `src/lib/utils.ts`** (`text`, `radius`, `shadow`, `ease` — mirroring
  `globals.css`). An undeclared size token falls into the catch-all colour group,
  so `cn("text-instrument text-muted")` silently deletes the size and the element
  renders at the inherited scale instead of its token's — invisible in tests,
  because the class string still looks plausible. Adding a token to a custom
  scale updates both files.
- **Important utilities use Tailwind v4's trailing flag (`absolute!`), written as
  literals in source.** A leading `!absolute` generates no CSS in v4, and a class
  built at runtime (string-appending `"!"`) is invisible to Tailwind's scanner —
  either way the style silently never applies, which on third-party unlayered CSS
  (xyflow's handle styles beat layered utilities regardless of import order) means
  the library default wins and no test notices.
- **Accessibility is part of done**: accessible names on icon buttons,
  `htmlFor` on labels, `aria-expanded` on expandables, and anything
  keyboard-reachable must actually work with a keyboard (test with `user-event`,
  not `fireEvent`, when focus/keyboard semantics matter).

## Server/Client component boundaries (Next.js App Router)

- **`"use client"` marks a boundary.** Everything imported by a client
  component becomes client code. Put the directive on the interactive leaf,
  never reflexively at the top of the tree.
- **Server components can't receive functions or use hooks.** If a route file needs
  state, effects, or handlers, that logic belongs in a client component it renders
  — the `page.tsx` stays a thin shell either way.
- **Hydration mismatches come from render-time nondeterminism:** `Date.now()`,
  `Math.random()`, locale-dependent formatting, and browser-only globals during
  first render. Render the deterministic default, then update after mount.
- **Async readiness redirects gate the entire protected shell.** Keep nav and page
  content unmounted behind an accessible loading state until the check resolves and
  while redirecting — rendering first and redirecting from an effect flashes content
  the user can't use yet.
- **This app's data flow is deliberately client-side** (token in localStorage →
  `apiFetch`); the auth guard is a client-side redirect in `(console)/layout.tsx`
  with no `middleware.ts`. Don't introduce one-off server-side data fetching or
  route handlers for a single feature — that's an architecture change, not a
  feature.
- **Admin pages live under `(console)/admin/` and are double-gated.**
  `admin/layout.tsx` redirects non-admins client-side (UX only); the API's
  `require_admin` is the real enforcement — **never treat any client-side gate as
  security**. The Admin nav link renders only when `user.role === "admin"`.

## Logging & debug artifacts

**No `console.log`/`console.debug` in committed code.** `console.warn`/`console.error`
only, for genuinely exceptional situations. Production builds strip the rest and
lint forbids them. Never write a `useEffect`
whose only job is logging (one keyed on stream state re-runs on every token).

**Request correlation and error reporting go through `src/lib/observability/`.**
`apiFetch` already sends an `X-Request-ID` per call and reads the backend's
returned id onto `ApiError.requestId` (present even on 500s); error surfaces show
it via `getRequestId(err)` so a user can quote a support reference. The package is
correlation only — **never add browser analytics, automatic user-action tracking,
remote error shipping, or request/response payload capture** (the issue that
created it forbids them). The client error buffer records request IDs, error
messages, and the failing script's `path:line:column` with the query string
stripped — a parse error's message names no script, so without the source a
downloaded report is an unattributable string — never bodies or tokens; the user diagnostics report
(`downloadDiagnosticsReport`) and the admin "Download diagnostics" bundle are the
only ways anything leaves the browser, and only on an explicit click. The header
name is pinned by `tests/assets/observability_contract.json` (asserted here and
in pytest) — don't hardcode `"X-Request-ID"` elsewhere.

## Environment

**Node version is pinned** (`.nvmrc`, `engines` in package.json). Node ≥22.4's
built-in `localStorage` shadows jsdom's in Vitest — `src/test/setup.ts` stubs Web
Storage with an in-memory implementation. If storage-related tests fail
mysteriously, check Node version drift first.

## Testing

- **Tests assert behavior, not wiring.** A test must be able to FAIL when the
  behavior it names breaks. Mutation-check it mentally: "if I deleted the code
  under test, would this fail?" A test that can't fail is worse than no test.
- **Never write these:** tests that invoke a captured callback prop and assert
  nothing about the outcome; `expect(x).toEqual(expect.any(Object))`; tests of
  barrel files; snapshot-style class-name assertions when a role/text query
  exists.
- **Coverage is a floor, not a goal.** A smaller suite of diagnostic tests beats a
  large suite of wiring tests that break on every refactor and catch nothing.
  Never add a test just to move a percentage.
- **Prefer accessible queries** (`getByRole`, `getByLabelText`, `getByText`) and
  `@testing-library/user-event` where keyboard/focus semantics matter.
- **Async state updates resolve inside `await act(async () => …)`.** Resolving a
  promise outside `act` can make an assertion pass vacuously because the re-render
  never committed — a guard test written this way passes even with the guard
  deleted.
- **Giant test files mirror giant components.** If a component's test must mock
  every child and capture their props, decompose the component, not the test.
- **Mocks and fixtures are centralized.** `src/test/mocks.ts` provides
  `mockApi(overrides?)` and `mockAuth(user?)` — never hand-roll a
  `vi.mock("@/lib/api")` shape in a test file — divergent copies drift, and one
  that mocks the wrong argument order hides real bugs.
  `src/test/fixtures/` provides `make*` builders for every domain object; don't
  re-declare inline literals. When an API signature changes, the factory is the
  single place mocks update.
- **Name tests after behavior, not methods.** "submits full node config when
  pipelines load after expanding advanced options" tells the next reader what
  contract broke; "handleToggleAdvanced works" doesn't.
