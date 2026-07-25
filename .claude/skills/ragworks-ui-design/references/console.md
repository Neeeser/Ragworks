# The console surface — the soft-depth workbench

Rules for everything under `frontend/src/app/(console)/`. The landing page is a different
surface with different rules (`landing.md`); they share only the token system and the copy
voice.

The console is a workbench for building and debugging RAG pipelines — used by power users
*and* by low-code users who must not feel they've opened an internal tool. It is judged on
two questions at once: **how much of the screen is the data**, and **does it look like a
product someone finished**. Density answers the first; material, accent, and the signature
marks answer the second. Neither is optional.

---

## 1. The shell

`AppShell` (`components/ui/app-shell.tsx`) owns the console chrome. Three parts:

```
┌─────────┬──────────────────────────────────────┐
│         │ Top bar (CrumbBar)            48px   │  ← breadcrumb path + state + actions
│ Sidebar ├──────────────────────────────────────┤
│ (NavRail│ [Tabs — sectioned entities]   36px   │  ← collection sections, admin sections
│  184px) ├──────────────────────────────────────┤
│         │  content — full bleed, no max-width  │
└─────────┴──────────────────────────────────────┘
```

- **Sidebar** — 184px, collapsible to a 48px icon rail (`useNavCollapsed`; expanded is
  the default and the choice persists per browser). Wordmark row at top (logo mark +
  "Ragworks", 13px semibold) with the collapse toggle; one labeled item per section:
  icon + sentence-case label, `rounded-control`, 32px tall. Collapsed, labels return as
  right-side tooltips and the flyouts keep working. Active item:
  `bg-accent-violet/12 text-primary` plus a 2px `.trace-wire` bar on its left edge.
  Footer pins the account menu and theme control. Width animates 160ms decel (the user
  moved it), no-op under reduced motion.
- **Top bar** — 48px (`CrumbBar`). Carries the breadcrumb path (see signature marks),
  live system state, and the page's actions — including the page's one primary button.
- **Tabs** — 36px, only on sectioned entities (a collection's
  Overview/Files/Search/Diagnostics/Visualize). Active tab is `text-primary font-medium`
  with a 2px `.trace-wire-x` underline that *slides* between tabs (160ms, decel).
  Sub-routes use tabs — never a second sidebar; two sidebars fight for the same edge.
- **Content** — fills everything else. **No `max-width`.** `PageBody` provides `p-4`;
  cards inside separate with `gap-3`.
- The shell also owns the console's **single bloom** (`.console-bloom`) and nothing else
  may add one.

### Sidebar rules

- **Labels are visible; flyouts add depth.** Every section shows its name — nobody
  hovers to learn what an icon means. Hovering or focusing an item still opens its
  `RailFlyout`: one factual line of what the section is, plus up to five real
  destinations (recent collections, recent chats, pipeline kinds with counts).
- **Flyout intent timing and keyboard behaviour are non-negotiable** — see `motion.md`
  (70ms first open / 0ms switch / 120ms leave; focus opens instantly; Escape closes and
  restores focus *focus-first-close-second*; the hover bridge lives inside the trigger's
  wrapper so the pointer never crosses dead space).
- **Chrome that shows data loads on first open, never on page load**, through
  `SharedQueryStore` (`lib/rail-preview-cache.ts`). A page load pays nothing for a flyout
  the user may never open.
- **A page never renders its own title block.** The breadcrumb path already says where
  you are. Title blocks cost ~110px each and repeat the nav.
- **The top bar is where live state goes** — store backend, BM25 availability, connection
  validity, time range. The one place a user can always see whether the system under them
  is healthy.
- **⌘K is an accelerator, never the only route.**

---

## 2. Composition

> **Cards for state and time-series. Rows for entities. Rows live inside a card.**

One rule decides the form. The failure modes it prevents: Grafana-style panels around a
list of names (a spreadsheet), and loose rows floating on the canvas (unfinished).

| The data is… | Form |
|---|---|
| a current value you glance at | KPI cell, in a KPI card row on the *owner's* page |
| a measure over time you *read* | chart card, ≥104px plot |
| an entity you might click into | a row inside the list card |
| a set of entities | one card, one row per entity |
| a selected thing's fields | docked inspector |

### Cards are objects; rows share hairlines

Adjacent cards are separate elevated objects — `card-surface`, separated by `gap-3`.
*Inside* a card, rows separate with `border-hairline` only. Never a card per row, and
never a bare row list on the canvas.

### Multi-pane cards: the secondary pane wears `bg-surface`

In a two-pane card (list + preview, sidebar + canvas, history + transcript), the
**secondary** pane — the one that navigates or inspects — carries `bg-surface` fill on
top of the hairline seam, so the panes read as different rooms and the layout doesn't go
flat. The primary working pane stays on the card material. Fill plus seam, never the
seam alone; and never a third fill level inside one card.

### Stats belong to their owner

- An **entity list** never gets an aggregate KPI strip above it. Each entity's numbers
  are columns on its own row (the row is the entity's dashboard).
- An **entity's own page** (a collection's Overview) is where its KPI cells live.
- Container ceiling: page → card → row. A value never gets its own bordered box.

---

## 3. The signature marks

Three small, repeated marks make the console unmistakably Ragworks. They are product
truths, not decoration — and they are the *complete* set; do not invent a fourth.

### The breadcrumb path (S1)

The top bar's breadcrumb renders as **nodes on a wire**: each crumb is preceded by a
square node dot (7px, `rounded-[2px]`), segments joined by short 1.5px wires fading from
`--accent-violet` at 40% to 15%. The current location's node is solid
`bg-accent-violet` with a soft accent glow; its label is `text-primary font-medium`.
Drill-down *is* a pipeline path. Costs 8px per segment.

### Node dots (S4)

Every status dot in the console is a **square node dot** — `rounded-[2px]`, 6–7px, with
a soft same-colour glow at ~50% alpha (`box-shadow: 0 0 8px`) when the state is positive
or live. A tiny pipeline node. `StatusDot` owns this; never hand-roll a circle.

State is **derived, never invented**: a collection with no documents → neutral, documents
but no chunks → warn, indexed → pos. A dot that means nothing is worse than no dot.

### The pulse (S5)

The one expressive motion, licensed **only while data is actually flowing**:

- A file ingesting: its stage strip lights stage-by-stage, the active wire segment fills,
  the status pill narrates (`parsing` → `chunking` → `embedding` → `indexing`).
- A streaming chat response / running query or eval: a 2px `.pulse-track` wire with a
  travelling `.pulse-beam` light.

If nothing is flowing, nothing pulses. An idle pulse is a lie and spends the mark's
meaning. The pipeline editor's playback beam + edge comet are this same signature at
full scale — they stay, timed by the run's real clock.

### Stage strips (supporting mark)

Where a row or chip names a bound pipeline, show it as a compact strip of stage-coloured
node dots joined by hairline wires (6px nodes), with a plain-text summary
(`hybrid · RRF · pgvector`). Metadata, not layout — the strip never exceeds one line and
never appears where no real pipeline is bound.

### The light budget

| Device | Allowance |
|---|---|
| Bloom | exactly one, shell-owned |
| Glowing (filled, halo'd) button | one per view — the primary action |
| Trace wire | active sidebar item + active tab, nothing else |
| Pulse | live processes only |
| Node-dot glow | pos/live states only |

The glow budget counts what is *on screen at once*: when an empty state repeats the top
bar's primary action, the empty state's button is plain primary — the top bar keeps the
view's one glow (a page whose top bar has no button may glow its empty state instead).

---

## 4. Colour — quiet is not colourless

**Every list row and every card should carry at least one piece of meaning-bearing
colour**, and there is almost always a real one available:

| Where | Colour that means something |
|---|---|
| A row for an entity with a state | `StatusDot` (node dot) or a status `Chip` pill |
| A row naming a pipeline, stage, or mode | stage strip, or a `Chip` with the stage tone |
| A count that can be bad | `tone="neg"`/`"warn"` when non-zero |
| A chart | `--series-*` |
| The primary action | `bg-accent-violet` + `shadow-glow` |
| Live/streaming state | `text-accent-cyan` + pulse |

Rules that keep it from becoming noise:

- **Colour rides a dot, a strip, or a pill fill — not arbitrary text.** A status pill's
  label may take the tone (`text-data-pos` on a `Ready` pill); random coloured words fail
  for anyone who can't discriminate hue.
- **Derive state, never invent it** (see node dots above).
- A converted page whose only colour is the primary button means state that exists in
  the data was not surfaced — that is a defect, not restraint.

---

## 5. Density in practice

| Element | Height |
|---|---|
| Top bar | 48px |
| Tabs row | 36px |
| Toolbar / card header row | 32px |
| Data row | ~40px single-line, ~56px with a meta line |
| KPI cell | ~64px (label + 20px value, in the KPI card) |
| Chart card plot area | ≥104px |

**Charts get the height; everything else gives it up.** A 42px sparkline is decoration;
104px with ticks is an instrument.

### Never

- Three levels of container. Page → card → row is the ceiling.
- A single value in its own bordered box.
- Vertical space reserved for absent data (`detail ?? " "` is a layout bug as a string).
- A region that ends mid-viewport: give the last card's list `min-h-0 flex-1` inside a
  flex column so a short list reads as a card with little in it, not a failed load.

---

## 6. The measure rule

> **The card is full-width. The text inside it gets a measure.**

Prose caps at `max-w-[66ch]`; the card still spans the viewport. Never centre a card to
achieve reading width. Applies to chat transcripts, empty-state copy, tooltip bodies,
inspector help, diagnostics messages. Never to tables, rows, charts, canvases.

---

## 7. Empty states

One line of plain text plus, at most, one action, inside the card the data would fill:

```tsx
<div className="p-8 text-center">
  <p className="text-ui text-muted">No collections yet.</p>
  <Button size="sm" className="mt-3">Create collection</Button>
</div>
```

Not an illustration, not a nested panel, not a sentence explaining the feature.

---

## 8. Text you must not write

Delete on sight:

| Pattern | Real example from this repo |
|---|---|
| An eyebrow restating the list | `COLLECTION` stamped above every collection |
| A placeholder for absent optional data | `"No description yet."` |
| A greeting | `Welcome back, {name}.` |
| A subhead narrating the UI | `Pick a collection to dive into documents…` |
| A label strip naming things the screen isn't about | decorative stage-dot rows on settings |

Keep text that tells the user something the UI cannot show: a constraint, a consequence,
where a value came from.

---

## 9. Loading and error

- **Loading is a skeleton at the content's final geometry** with the directional shimmer
  (left→right — the signal direction). Data landing causes zero reflow.
- **Never** a spinner centred in a padded panel.
- Errors render in place, in `text-data-neg`, with the request id available via
  `getRequestId(err)`.
- **Absence is not an error.** A 404 for a thing that simply doesn't exist yet (no
  projection computed, no runs recorded) renders the *empty state*, never a red error
  line — check `ApiError.status` before surfacing the message.
- **State a fact once per screen.** An empty page that says "nothing here" in the
  toolbar, again as an error line, and again in the empty region is the text rule
  failing three ways at once; the emptiest region says it, everything else stays quiet.

---

## 10. Primitives — use them, never re-roll

| Need | Component |
|---|---|
| console chrome (sidebar + bloom) | `AppShell` / `NavRail` |
| top bar: breadcrumb path + state + actions | `CrumbBar` |
| section tabs with the sliding wire | `Tabs` |
| an elevated card | `Panel` (renders `card-surface`) |
| a KPI row | `KpiStrip` (one card, cells inside) |
| a time-series | `ChartPanel` |
| a list entity | `DataRow` inside a `Panel` |
| column headers for a row list | `DataRowHeader` |
| status (node dot + optional label) | `StatusDot` |
| a status/kind pill | `Chip` (pill form: tinted fill, dot, sentence case) |
| a link wearing button chrome | `ButtonLink` — never a hand-rolled anchor class string |
| a bound pipeline as metadata | `StageStrip` |
| live-process indicator | `PulseWire` / the ingestion stage pulse |
| selected-item fields | `Inspector` |
| explaining a truncated or terse value | `Tooltip` — never a `title` attribute |
| hover/focus preview panel | `RailFlyout` + `useFlyoutIntent` |
| loading placeholder | `Skeleton` |
| overlay of any kind | `ModalOverlay` |
| form control | `Field` / `TextInput` / `Select` / `TextArea` + `inputClass` |
| dropdown selection | `CustomSelect` — never a native `<select>` |
| confirmation | `ConfirmDialog` |
| wizard | `WizardShell` + `WizardFooter` |

`DataRowHeader` shares `DataRow`'s cell padding, gap and actions-slot width — never
hand-roll a header row with a guessed spacer; each column's width class must be on the
element the flex row measures.

`GlassCard` and `.glass-panel` are **landing-only** — blur on a data card is the wrong
look and a real compositing cost.

---

## 11. Small screens

Desktop-first: density and composition are designed at ≥1280px and never diluted for
phones. Below `lg` the page still works — by *reflow*, not by hiding capability:

- Multi-pane layouts collapse: the preview/inspector becomes a full-screen overlay
  (`ModalOverlay`), the secondary pane stacks or hides behind an explicit control.
- Toolbars wrap (`flex-wrap`); the primary action stays visible, secondary actions may
  fold into a menu.
- Row lists drop *columns* before they drop rows — keep name + status + the one number
  that matters; the full record stays reachable on the row's own page.
- Wide tables/canvases scroll inside their own `overflow-x-auto`; the page never scrolls
  horizontally.
- Touch targets ≥32px; hover-only affordances (flyouts, tooltips, drag-drop) always have
  a click/tap-or-keyboard path — the keyboard rules below already force this.

---

## 12. Placing chrome inside cards — clipping

`card-surface` lists usually carry `overflow-hidden` (rounded corners) and `PageBody`
scrolls. Any absolutely-positioned chrome inside them (tooltips, popovers) must open
toward the card's interior — a tooltip opening off the card's top or outer edge gets
clipped. Pick the side per placement (`side="bottom"` in a toolbar at the card's top,
`side="left"` at a right edge); a menu that measures itself to clamp to the viewport
must not get a scale entrance, because it would measure a mid-animation box.

---

## 13. Quality floor

Part of "done", not polish:

- `focus-visible:ring-2 ring-accent-violet ring-offset-canvas` on every interactive
  element.
- `aria-label` wherever the visible text doesn't name the control.
- Keyboard: anything clickable is reachable and activatable (`user-event` in tests).
- No horizontal page scroll; wide content scrolls in its own `overflow-x-auto`.
- Both structural modes verified (dark + light).
- `prefers-reduced-motion` honoured — see `motion.md`.
- Never nest a `<button>` inside a clickable row (`role="button"` div pattern —
  `FileGridView`).
- **A hover-opened panel is reachable by keyboard or it doesn't ship.** Focus opens it,
  Escape closes it and restores focus — focus first, close second, one React batch, or
  Escape reopens what it dismissed (verify by pressing Escape from a control *inside*
  the panel; jsdom hides the bug, browsers don't).
- **Two links to the same destination is one too many** — a row-action icon going where
  the row already goes is a redundant tab stop; delete the icon.
