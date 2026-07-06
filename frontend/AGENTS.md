# Frontend Engineering Practices

Rules for working in `frontend/` (Next.js App Router + React 19 + TypeScript). Most
rules here exist because we found and fixed the opposite in this codebase — don't
reintroduce them. The core idea throughout: **small, component-driven, well-named files
that one person can hold in their head at once.** Repo-wide rules (verify gates, the
bug-fix regression-test rule, commit conventions) live in the root `AGENTS.md`.

## The gate

**`npm run verify` (typecheck → lint → tests) must pass before every commit.** All three
stages are errors-fail. Lint enforces the structural rules mechanically: `max-lines` 400
(production code), `no-console` (warn/error allowed), `react-hooks/exhaustive-deps` as
error, `import/no-duplicates`, `import/no-cycle`. `complexity`/`max-depth` warn — treat a
new warning in your diff as a design prompt, not noise. The `react-hooks/set-state-in-effect`
override for six grandfathered hooks is a burn-down list, not a pattern to copy — never
add a file to it. Do not add `eslint-disable` without a comment saying why, and never
disable `max-lines` — split the file instead.

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

## Adding a feature end-to-end

The expected shape, in order:

1. **Types** — add/extend wire types in `src/lib/types/<domain>.ts`, matching the
   backend schema in `app/schemas/` (check it — don't guess the shape).
2. **API module** — add the typed function to the right `src/lib/api/<domain>` module,
   through `apiFetch`, `token` first. No `fetch()` anywhere else.
3. **Hook** — a custom hook owning the state domain (data loading via `useApiQuery`,
   mutations with error/success channels). Complex state gets a pure `*-reducer.ts`
   with its own tests.
4. **Component** — renders from the hook's API, built on `components/ui` primitives.
5. **Page** — the route file under `app/` composes the component; no logic in it.
6. **Tests** — behavior tests for the reducer/hook logic and the key user-visible
   flows, using `src/test/mocks.ts` and `src/test/fixtures/` — never hand-rolled mocks.

Chat Studio (`components/chat-studio/`) is the reference implementation of this shape.
Then run the gate (`npm run verify`).

## Fixing a bug

Follow the root rule: **regression test in the same commit, verified red-green.**

1. Reproduce with a failing test at the lowest level that exhibits the bug (pure
   `lib/` function or reducer > hook > component). Watch it fail for the bug's reason.
2. Fix. Watch it pass. Run `npm run verify`.
3. If the bug reveals a reusable rule, add one line to the relevant section of this
   file in the same PR — that's where most of the rules below came from.

## Code structure

- **File size is a design signal.** Components and hooks stay under ~300 lines; 400 is the
  hard lint ceiling (tests exempt). If a file approaches the limit, it has more than one
  responsibility — split it. We once had a 3,143-line component with 55 `useState` calls;
  never again.
- **One responsibility per file.** A component renders; a hook owns one state domain; a
  `*-utils.ts` module holds pure functions. If you can't name the file after its single
  job, it has more than one.
- **Logic lives in hooks, not components.** When a component accumulates fetch effects,
  handler groups, or derived-state chains, extract a custom hook per state domain
  (`useModelCatalog`, `usePineconeIndexes`, …). The component composes hooks and renders.
- **Reducers over state constellations.** More than ~5 related `useState` calls that
  update together, or any ref that exists only to mirror state for closures, means the
  state has outgrown `useState` — use `useReducer` with named actions. Copy-pasting a
  "reset all these states" block is the classic symptom (we had the same reset block
  pasted three times; a reducer `RESET` action replaced it).
- **Pages are thin shells.** Route files under `app/` delegate to components/hooks; no
  business logic, no fetch orchestration in a `page.tsx`.
- **Feature folders separate components from logic.** Inside a feature folder
  (`chat-studio/`, `pipelines/`, …), components live at the root, pure non-React modules
  (helpers, constants, types, reducers) in `lib/`, and hooks in `hooks/` — grouped into
  domain subdirectories (`messaging/`, `session/`, `settings/`) once they outgrow ~10
  files. A single-file folder isn't a feature: colocate the file with its only consumer
  instead (ChunkPreviewOverlay moved into `collections/detail/visualize/` for this
  reason).
- **Chat Studio is the reference decomposition.** `ChatStudio.tsx` is a ~390-line
  orchestrator composing single-domain hooks under `chat-studio/hooks/` (grouped into
  `messaging/`, `session/`, and `settings/` subdirectories, with cross-cutting hooks at
  the `hooks/` root) plus a pure reducer module (`chat-studio/hooks/messaging/
  chat-stream-reducer.ts`) with focused tests. New features follow this shape: add a
  hook or extend the reducer — don't grow the orchestrator.
- **Reducers live in pure modules.** State shape, action types, and the reducer function
  go in a plain `*-reducer.ts` with no React imports so they're unit-testable; the hook
  file owns only `useReducer` wiring, refs, and the exposed API.
- **Group props by domain, not by count.** When a component's prop list grows past ~10,
  group related props into typed objects built with `useMemo` (see TelemetryPanel's
  grouped props). A 78-prop interface is a smell that the parent owns state the child's
  hooks should own.
- **`React.memo` only works with stable props.** If you memoize a child, every object/
  callback prop it receives must come from `useMemo`/`useCallback` — one inline literal
  defeats the whole memo. During streaming this is the difference between re-rendering a
  timeline and re-rendering the entire page per token.
- **Hydration-safe initializers.** Never read `localStorage`/`sessionStorage`/`window.*`
  inside a `useState` initializer — the server render uses different values and React
  hydration mismatches. Initialize with the default, hydrate in a mount effect, and gate
  any effect that reacts to the hydrated value behind a `hydrated` flag so it can't fire
  against first-paint defaults.
- **Effects must not write state they derive.** Computing a value in a `useMemo` and then
  copying it into `useState` via an effect adds a render per change and a stale window.
  Derive it where you use it.
- **When replacing an effect, enumerate every ordering it handled.** A reactive effect
  re-fires when async data arrives; a click handler runs once. Converting one to the
  other silently drops the "data resolved after the interaction" path — we shipped (and
  caught in review) a data-loss bug exactly this way. For seed/sync logic, prefer a
  render-time state adjustment guarded so it only fires when the target is still empty
  and the seed is non-empty (both guards matter — the second prevents an infinite
  setState loop on empty seeds).
- **Delete dead code on sight.** No-op callbacks drilled through props, re-export blocks
  "for convenience", helpers that wrap a single operator — remove them. Dead code is not
  harmless; it costs every future reader.

## Duplication

- **Second copy = extract.** The moment you paste a function, class-string, constant, or
  JSX block into a second file, stop and extract it to the shared layer it belongs to
  (`lib/`, `components/ui/`, or the feature's `*-utils.ts`). We removed a 62-line
  function that had been duplicated verbatim across two files, and an input class string
  copied 29 times.
- **Derive, don't duplicate types.** When one type is a subset/variant of another, derive
  it (`Extract<...>`, `Omit<...>`, `Pick<...>`) instead of maintaining a parallel
  interface that will drift.
- **Constants are defined once.** Sentinel strings (`CREATE_SENTINEL`), size constants,
  and default flags live in one exported constant; a second definition that "must stay in
  sync" with the first is a latent bug.
- **UI state lives in the component that uses it.** Search terms, sort orders, and other
  view-local state belong inside the component (or its own hook) — not lifted to a parent
  that just drills them back down. Lifting state a parent never reads created a 10-prop
  card and a triplicated filter pipeline. (Corollary: state that must survive the
  component unmounting is the exception — then it genuinely belongs to the parent.)
- **Library monkey-patches are quarantined.** If a prototype patch is truly unavoidable,
  it lives in its own `*-patches.ts` module with an idempotence guard and a comment
  explaining why — never inline in a component file.

## TypeScript

- **`npm run typecheck` must exit 0 before every commit.** It is the first stage of
  `npm run verify`. This codebase once accumulated 227 unnoticed errors because no gate
  existed; one of them was a shipped runtime crash.
- **Never suppress:** no `any`, no `@ts-ignore`, no `@ts-expect-error` in source. Fix the
  type. An `as` cast is a last resort for invariants the type system can't express — keep
  it local and comment why.
- **Narrow, don't cast.** Use type guards (`typeof x === "number"`, `"field" in obj`,
  discriminant checks) to handle unions. Casting through `unknown` in source code hides
  real mismatches.
- **Learn the library's generics.** `@xyflow/react` v12 takes the full node type
  (`NodeProps<Node<PipelineNodeData>>`), not the data type; `new Map(entries)` needs
  `[K, V]` tuples, not `string[][]`. When a library upgrade changes generics, fix the
  usage — don't cast around it.
- **Types are organized by domain** in `src/lib/types/{common,collections,chat,pipelines,traces}.ts`
  with an `index.ts` barrel (`@/lib/types` keeps working). Add new wire types to the right
  domain file. These hand-mirror the FastAPI schemas; if a shape is uncertain, check the
  backend schema instead of adding a `[key: string]: unknown` escape hatch. (Future work:
  generate these from `/openapi.json` via `openapi-typescript`.)

## API layer

- **Every network call goes through `src/lib/api/`** — domain modules
  (`auth/collections/pipelines/chat/models`) behind the `@/lib/api` barrel, all funneling
  through `apiFetch` in `client.ts`. No stray `fetch()` outside this layer.
- **`token` is always the first parameter** of an authed API function. Mixed orders
  (`(id, token)` vs `(token, id)`) with same-typed adjacent params produce swaps the
  compiler can't catch.
- **Errors are typed.** `apiFetch` throws `ApiError { status, detail }`
  (`src/lib/api-error.ts`); use `isUnauthorized(err)` for 401 handling and
  `getErrorMessage(err, fallback)` (`src/lib/errors.ts`) to display messages. Never write
  the `err instanceof Error ? err.message : "…"` ternary inline — it was copy-pasted 46
  times before we centralized it.
- **`"use client"` belongs on components/hooks only** — never on plain `lib/` modules; it
  forecloses server-side use for no benefit.

## Data fetching in components

- **Use `useApiQuery(fn, deps)`** (`src/lib/use-api-query.ts`) for load-on-mount /
  reload-on-change data. It owns the loading/error/cancellation lifecycle. Do not
  hand-roll the `useEffect` + `let cancelled = false` + `setLoading/setError/setData`
  dance — it existed 18 times, and the copies that forgot the `cancelled` guard were
  race bugs.
- **Never swallow a fetch error.** Every failure surfaces to the user through the
  component's error channel (message state, notice banner). A `.catch` that only flips a
  boolean, or a `try/finally` with no `catch`, is a bug we've had to fix — twice.

## UI primitives — use them, don't re-roll them

- **Every overlay is `ModalOverlay`** (`components/ui/modal-overlay.tsx`). Never hand-roll
  a `fixed inset-0 z-50` div: we had five of them, each with different Escape/backdrop/
  focus behavior and half without `role="dialog"`. ModalOverlay owns Escape-to-close,
  backdrop click, focus-into-dialog, focus restore, Tab containment, scroll lock, and
  ARIA wiring. Dialogs pass `labelledBy` pointing at their title element.
- **Every form control goes through `Field`/`TextInput`/`Select`/`TextArea`**
  (`components/ui/field.tsx`). Field wires `htmlFor`/`id` via `useId` and `aria-describedby`
  for hint/error text. The canonical input styling lives in the exported `inputClass`
  constant — the raw class string was once copy-pasted 29 times; if you type
  `rounded-2xl border border-white/10` by hand into a form control, stop.
- **Confirmations use `ConfirmDialog`**, including destructive type-to-confirm flows via
  its `confirmText` prop — don't build bespoke nested delete modals.
- **Wizards use `WizardShell` + `WizardFooter`** — the Back/Next/Cancel cluster is one
  component, not per-wizard JSX.
- **`Button loading` keeps its children visible** (spinner + `aria-busy` + disabled).
  Never swap button content for placeholder text; it causes layout shift and breaks
  accessible names.
- **Nested dialogs: Escape closes only the topmost.** ModalOverlay maintains an internal
  overlay stack for this — you get correct stacking for free by using it. If you ever
  need custom close behavior, preserve the one-layer-per-Escape convention.
- **Clear stale feedback at the start of each attempt.** A retryable action (create,
  save, submit) clears its error AND success channels at the top of every attempt —
  otherwise a stale "failed" banner survives next to a fresh success message. When a
  handler moves into a hook, this reset is the easiest line to lose; the hook should own
  it (e.g. an `onCreateStart` callback), not hope the caller remembers.
- **`cn` resolves Tailwind conflicts via `tailwind-merge`** — a later class deterministically
  wins over an earlier conflicting one. Don't rely on stylesheet order, and don't use `cn`
  for non-class strings (e.g. joining ARIA id lists — use a plain join).
- **Accessibility is part of done**, not polish: interactive elements need accessible
  names (`aria-label` on icon buttons), labels need `htmlFor`, expanded/collapsed state
  needs `aria-expanded`, and anything keyboard-reachable must actually work with a
  keyboard (test with `user-event`, not `fireEvent`, when focus/keyboard semantics matter).

## Server/Client component boundaries (Next.js App Router)

- **`"use client"` marks a boundary, not a habit.** Everything imported by a client
  component becomes client code. Put the directive on the interactive leaf/feature
  component, not reflexively at the top of the tree — and never on plain `lib/`
  modules (covered above).
- **Server components can't receive functions or use hooks.** If a route file needs
  state, effects, or event handlers, that logic belongs in a client component it
  renders — the `page.tsx` itself stays a thin shell either way.
- **Hydration mismatches come from render-time nondeterminism:** `Date.now()`,
  `Math.random()`, locale-dependent formatting, and browser-only globals during the
  first render. Same rule as the storage one above — render the deterministic default,
  then update after mount.
- **This app's data flow is deliberately client-side** (token in localStorage →
  `apiFetch`), so don't introduce one-off server-side data fetching or route handlers
  for a single feature; that's an architecture change, not a feature.

## Logging & debug artifacts

- **No `console.log`/`console.debug` in committed code.** `console.warn`/`console.error`
  only, for genuinely exceptional situations. Production builds strip the rest via
  `compiler.removeConsole`, and lint forbids them — but don't rely on the safety net.
  Never write a `useEffect` whose only job is logging (we shipped one that re-ran on
  every streamed token).

## Environment

- **Node version is pinned** (`.nvmrc`, `engines` in package.json). Node ≥22.4's built-in
  `localStorage` shadows jsdom's in Vitest — `src/test/setup.ts` stubs Web Storage with an
  in-memory implementation. If storage-related tests fail mysteriously, check Node
  version drift first.

## Testing

- **Tests assert behavior, not wiring.** A test must be able to FAIL when the behavior it
  names breaks. Before trusting a test, mutation-check it mentally (or actually): "if I
  deleted the code under test, would this fail?" We deleted a test whose only assertion
  could never fire under React 19 — a test that can't fail is worse than no test.
- **Never write these:**
  - Tests that invoke a captured callback prop and assert nothing about the outcome.
  - `expect(x).toEqual(expect.any(Object))` — asserts existence, not behavior.
  - Tests of barrel files ("re-exports are defined") — pure coverage padding.
  - Snapshot-style class-name assertions (`querySelector("div.scroll-smooth")`) when a
    role/text query exists.
- **Coverage is a floor, not a goal.** We deliberately lowered thresholds; a smaller
  suite of diagnostic tests beats a large suite of wiring tests that must be updated on
  every refactor and catch nothing. Never add a test just to make a percentage move.
- **Prefer accessible queries** (`getByRole`, `getByLabelText`, `getByText`) and
  `@testing-library/user-event` for interactions where keyboard/focus semantics matter.
- **Async state updates resolve inside `await act(async () => …)`.** Resolving a promise
  outside `act` can make an assertion pass vacuously because the re-render never
  committed — we found a "stale response ignored" test that passed even with the guard
  deleted for exactly this reason.
- **Giant test files mirror giant components.** If a component's test needs to mock every
  child and capture their props to be testable, the component is too big — decompose the
  component instead of growing the test.
- **Mocks and fixtures are centralized.** `src/test/mocks.ts` provides `mockApi(overrides?)`
  and `mockAuth(user?)` — never hand-roll a `vi.mock("@/lib/api")` module shape in a test
  file (we deleted 18 divergent copies, several of which mocked functions with the WRONG
  argument order and hid real bugs). `src/test/fixtures/` provides `make*` builders for
  every domain object; don't re-declare inline Collection/Pipeline/Session literals.
  When an API function's signature changes, the factory is the single place mocks update.
- **Name tests after behavior, not methods.** "submits full node config when pipelines
  load after expanding advanced options" tells the next reader what contract broke;
  "handleToggleAdvanced works" doesn't.

## Known gaps (deliberate, tracked — not license to add more)

- **No CI pipeline in the repo.** `npm run verify` is only enforced by discipline; wiring
  it into CI (plus `npm run build`) is the single highest-value next step.
- **No E2E layer** (Playwright/Cypress). The suite is unit/component only.
- **Types are hand-mirrored from FastAPI.** Generate from `/openapi.json` via
  `openapi-typescript` to eliminate drift.
- **`noUncheckedIndexedAccess` is off** — enabling it surfaced 182 errors; burn down in a
  dedicated pass, don't half-enable.
- **Six grandfathered hooks** carry `react-hooks/set-state-in-effect` warnings (see
  eslint.config.mjs) and there are ~24 `complexity` warnings — both are burn-down lists.
- **Auth guard is client-only** (redirect in `(console)/layout.tsx`, token in
  localStorage; no `middleware.ts`). Safe only because the API enforces auth server-side;
  a cookie + middleware migration would remove the loading flash and harden it.
