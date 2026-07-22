# Frontend Engineering Practices

Rules for working in `frontend/` (Next.js App Router + React 19 + TypeScript). Most
rules here exist because we found and fixed the opposite in this codebase — don't
reintroduce them. The core idea throughout: **small, component-driven, well-named
files that one person can hold in their head at once.** Repo-wide rules (verify
gates, the bug-fix regression-test rule, commit/PR conventions) live in the root
`AGENTS.md` and apply here too.

## The gate

**`npm run verify` (typecheck → lint → tests) must pass before every commit.** All
three stages are errors-fail. Lint enforces the structural rules mechanically:
`max-lines` 400 (production code), `no-console` (warn/error allowed),
`react-hooks/exhaustive-deps` as error, `import/no-duplicates`, `import/no-cycle`.
`complexity`/`max-depth` warn — treat a new warning in your diff as a design prompt,
not noise. The `react-hooks/set-state-in-effect` override for six grandfathered
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

**Trace value displays are a registry, not a switch.** Pipeline trace inputs/outputs
render through `components/traces/values/`: an ordered `{ match, Component }`
registry picks the most specific view per value by _shape_ (`shape-guards.ts`), with
a normalized-JSON fallback last. A new node's payload gets a polished display by
adding one renderer entry + guard — never by branching inside the IO blocks. Every
view caps its own height and scrolls internally so a large value can't reflow the
viewer.

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
or `data.outputs.length` must tolerate their absence — an unguarded read crashed
the whole end-to-end trace (the "no ingestion view from an eval" bug), and it's
reachable on every hybrid document trace since default pipelines draw a store.

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
is itself a button (invalid HTML; shipped as a hydration error once); use a
`role="button"` div with keyboard activation like `FileGridView`.

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
   (`frontend/flows/<scenario>/`) in the same PR — see `sandbox/AGENTS.md`.

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
  than one responsibility — split it. (We once had a 3,143-line component with 55
  `useState` calls; never again.)
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
  main-thread cost is a few ms at those moments; keep it that way rather than
  reintroducing a worker.
- **While a node drags, routing freezes instead of blanking.** The provider
  holds its pre-drag geometry and submits nothing until drop, so per-edge
  signature matching keeps every unmoved edge on its exact routed path; only
  the dragged node's own wires fall back to the native step path that follows
  the cursor. Suppressing all routes during drag (the old rule) flipped the
  whole graph at grab; publishing mid-drag routes flips the wire on frames
  where the cursor pauses (the original drag-flash bug). Both stay fixed only
  if no route is ever computed against mid-drag geometry.
- **A route's committed shape must equal the native drag fallback wherever no
  obstacle forces a detour.** `edge-route-refinement.ts` canonicalizes every
  monotone, collision-free route to one midpoint right-angle jog — the same
  shape `getSmoothStepPath` draws mid-drag — so grab/drop doesn't flip the
  wire between two valid layouts, and near-aligned ports don't render the
  grid router's crammed micro-jog squiggle. Blocked corridors keep the
  router's node-avoiding path.
- **Shared downstream nodes sit between parallel branch rows.** In a hybrid
  pipeline graph, center a merge/output node vertically between its inputs so
  smooth-step edges don't route through either branch's node card.
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
- **`React.memo` only works with stable props.** Every object/callback prop a
  memoized child receives must come from `useMemo`/`useCallback` — one inline
  literal defeats the memo. During streaming this is the difference between
  re-rendering a timeline and re-rendering the entire page per token.
- **Hydration-safe initializers.** Never read
  `localStorage`/`sessionStorage`/`window.*` inside a `useState` initializer — the
  server render uses different values and hydration mismatches. Initialize with the
  default, hydrate in a mount effect, and gate any effect that reacts to the
  hydrated value behind a `hydrated` flag.
- **Effects must not write state they derive.** Computing a value in `useMemo` and
  copying it into `useState` via an effect adds a render per change and a stale
  window. Derive it where you use it.
- **Background refetches must be invisible to in-progress work.** The auth
  provider rotates the token every 12 minutes, re-running every data effect
  keyed on it — a reload must preserve the user's selection (re-find by id, not
  reset to `[0]`), return previous identities for unchanged content, and not
  flip `loading`. A fresh `nodeSpecs` identity once re-fired the canvas-seeding
  effect and silently wiped 12 minutes of unsaved pipeline edits.
- **Worker-backed providers own their full teardown.** On unmount, terminate the
  worker, cancel in-flight and pending work, and make already-queued microtasks
  no-op so tests and route transitions cannot retain stale background work.
- **When replacing an effect, enumerate every ordering it handled.** A reactive
  effect re-fires when async data arrives; a click handler runs once — converting
  one to the other silently drops the "data resolved after the interaction" path
  (we shipped a data-loss bug exactly this way). For seed/sync logic, prefer a
  render-time state adjustment guarded so it fires only when the target is still
  empty _and_ the seed is non-empty (the second guard prevents an infinite
  setState loop).
- **Delete dead code on sight.** No-op callbacks drilled through props,
  "convenience" re-export blocks, helpers wrapping a single operator — remove them.
  Dead code costs every future reader.

## Duplication

- **Second copy = extract.** The moment you paste a function, class-string,
  constant, or JSX block into a second file, extract it to the shared layer it
  belongs to (`lib/`, `components/ui/`, or the feature's `*-utils.ts`). We've
  removed a 62-line function duplicated verbatim and an input class string copied
  29 times.
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
  gate). This codebase once accumulated 227 unnoticed errors, one of them a shipped
  runtime crash.
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
  inline — it was copy-pasted 46 times before we centralized it.
- **`"use client"` belongs on components/hooks only** — never on plain `lib/`
  modules; it forecloses server-side use for no benefit.
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
  dance — it existed 18 times, and the copies that forgot the guard were race bugs.
- **Never swallow a fetch error.** Every failure surfaces to the user through the
  component's error channel. A `.catch` that only flips a boolean, or a
  `try/finally` with no `catch`, is a bug we've had to fix — twice.
- **Public runtime config comes from `useAppConfig()`**
  (`src/providers/config-provider.tsx`), never a one-off `fetchPublicConfig()` —
  the provider fetches once and keeps `DEFAULT_PUBLIC_CONFIG` (permissive) as the
  value until the fetch resolves and as the fallback if it fails, so the UI never
  blocks on the config service. Feature-gated UI checks flags against an explicit
  `=== false` / `!== false`, not truthiness, so the permissive default and the
  loading window never flash a feature off before the real value arrives.

## UI primitives — use them, don't re-roll them

- **Every overlay is `ModalOverlay`** (`components/ui/modal-overlay.tsx`). Never
  hand-roll a `fixed inset-0 z-50` div — we had five, each with different
  Escape/backdrop/focus behavior, half without `role="dialog"`. ModalOverlay owns
  Escape-to-close, backdrop click, focus management, Tab containment, scroll lock,
  and ARIA wiring; dialogs pass `labelledBy`. It portals to `document.body`: an
  ancestor's transform creates a stacking context, and a non-portaled overlay's
  `z-50` loses to the sticky `z-30` navbar.
- **Every form control goes through `Field`/`TextInput`/`Select`/`TextArea`**
  (`components/ui/field.tsx`) — Field wires `htmlFor`/`id` and `aria-describedby`.
  Canonical input styling is the exported `inputClass` constant; if you type
  `rounded-2xl border border-white/10` by hand into a form control, stop.
- **Product-facing dropdown selection uses `CustomSelect`**, never a browser-native
  `<select>` whose popup cannot follow the product theme. The shared primitive owns
  popup styling, keyboard/typeahead behavior, focus management, and portal
  positioning. Use a native control only when platform-native behavior is
  deliberately required, and document that reason next to the control.
- **Confirmations use `ConfirmDialog`**, including destructive type-to-confirm
  flows via `confirmText` — no bespoke nested delete modals.
- **Wizards use `WizardShell` + `WizardFooter`** — the Back/Next/Cancel cluster is
  one component, not per-wizard JSX.
- **`Button loading` keeps its children visible** (spinner + `aria-busy` +
  disabled). Never swap button content for placeholder text; it causes layout shift
  and breaks accessible names.
- **Nested dialogs: Escape closes only the topmost.** ModalOverlay's internal
  overlay stack gives you this for free; preserve the one-layer-per-Escape
  convention.
- **Clear stale feedback at the start of each attempt.** A retryable action clears
  its error AND success channels at the top of every attempt — otherwise a stale
  "failed" banner survives next to a fresh success message. When a handler moves
  into a hook, the hook owns this reset (e.g. an `onCreateStart` callback).
- **`cn` resolves Tailwind conflicts via `tailwind-merge`** — a later class
  deterministically wins. Don't rely on stylesheet order, and don't use `cn` for
  non-class strings (joining ARIA id lists — use a plain join).
- **Accessibility is part of done**, not polish: accessible names on icon buttons,
  `htmlFor` on labels, `aria-expanded` on expandables, and anything
  keyboard-reachable must actually work with a keyboard (test with `user-event`,
  not `fireEvent`, when focus/keyboard semantics matter).

## Server/Client component boundaries (Next.js App Router)

- **`"use client"` marks a boundary, not a habit.** Everything imported by a client
  component becomes client code. Put the directive on the interactive leaf/feature
  component, not reflexively at the top of the tree.
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
lint forbids them — but don't rely on the safety net. Never write a `useEffect`
whose only job is logging (we shipped one that re-ran on every streamed token).

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
  never committed — we found a guard test that passed even with the guard deleted
  for exactly this reason.
- **Giant test files mirror giant components.** If a component's test must mock
  every child and capture their props, decompose the component, not the test.
- **Mocks and fixtures are centralized.** `src/test/mocks.ts` provides
  `mockApi(overrides?)` and `mockAuth(user?)` — never hand-roll a
  `vi.mock("@/lib/api")` shape in a test file (we deleted 18 divergent copies,
  several mocking functions with the WRONG argument order, hiding real bugs).
  `src/test/fixtures/` provides `make*` builders for every domain object; don't
  re-declare inline literals. When an API signature changes, the factory is the
  single place mocks update.
- **Name tests after behavior, not methods.** "submits full node config when
  pipelines load after expanding advanced options" tells the next reader what
  contract broke; "handleToggleAdvanced works" doesn't.
