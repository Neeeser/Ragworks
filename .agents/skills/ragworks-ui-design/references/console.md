# The console surface — the workbench language

Rules for everything under `frontend/src/app/(console)/`. The landing page is a different
surface with different rules (`landing.md`); they share only the token system and the copy
voice.

The console is an instrument panel for someone debugging a RAG pipeline. It is judged on
one question: **how much of the screen is the data, and how fast can I read it?**

---

## 1. The shell

`AppShell` (`components/ui/app-shell.tsx`) owns the console chrome. Three parts:

```
┌──┬────────────────────────────────────────┐
│  │ CrumbBar                        34px   │   ← breadcrumb + system state + actions
│R ├────────────────────────────────────────┤
│46│                                        │
│px │  content — full bleed, no max-width   │
│  │                                        │
└──┴────────────────────────────────────────┘
```

- **Rail** — 46px, icon-only, one entry per section, active state is
  `bg-accent-violet/16` + an inset violet ring.
- **CrumbBar** — 34px. Carries the breadcrumb, live system state, and the page's actions.
- **Content** — fills everything else. **No `max-width`, no page padding.**

Measured: this moves content from **61% to 91%** of a 1600×1000 viewport. The old shell
spent 28% of the width on `max-w-6xl` centring and 13% of the height on a 70px top nav plus
`py-8`.

### Rules

- **A page never renders its own title block.** The CrumbBar already says where you are.
  Every `PIPELINES / Ingestion pipelines` heading block cost ~110px and repeated the nav.
- **A page never adds horizontal padding to its outermost element.** Padding belongs to the
  panel or row inside it, not to the page. This is what full-bleed means.
- **The CrumbBar is where live state goes** — store backend, BM25 availability, connection
  count, validity, time range. It is the one place a user can always see whether the system
  under them is healthy.
- **⌘K is an accelerator, never the only route.** Every destination reachable by palette is
  also reachable by clicking.

---

## 2. The composition rule

> **Panels for state and time-series. Rows for entities and lists.**

One rule decides the form, so density never looks arbitrary. Applying it backwards is what
produces both failure modes: Grafana-style panels around a list of names reads as a
spreadsheet; Linear-style cards around a latency series wastes exactly the space this
redesign reclaimed.

| The data is… | Form | Component |
|---|---|---|
| a current value you glance at | KPI cell in a strip | `KpiStrip` |
| a measure over time you *read* | chart panel, ≥104px plot | `ChartPanel` |
| an entity you might click into | a row | `DataRow` |
| a set of entities | rows, one per entity | `DataRow` list |
| a selected thing's fields | docked inspector | `Inspector` |

### Panels share seams, not gaps

Neighbouring panels are separated by **one 1px line**, not by each having a border plus a
gap between them:

```tsx
// right
<div className="grid grid-cols-2 border-b border-hairline">
  <div className="border-r border-hairline p-3">…</div>
  <div className="p-3">…</div>
</div>

// wrong — floating cards
<div className="grid grid-cols-2 gap-4">
  <div className="rounded-panel border border-hairline p-3">…</div>
  <div className="rounded-panel border border-hairline p-3">…</div>
</div>
```

Seams read as one instrument with regions. Gapped cards read as unrelated widgets that
happen to be adjacent, and they cost double the separation pixels.

`PanelGrid` does this for you.

---

## 3. Density in practice

| Element | Height |
|---|---|
| CrumbBar | 34px |
| Toolbar / section header | 28px |
| Data row | 30px (`py-2` + `text-ui`) |
| KPI cell | 44px |
| Chart panel plot area | ≥104px |

**Charts get the height; everything else gives it up.** A chart is the only thing on a
console page you *read* rather than glance at, so it is the one element allowed to be
generous. A 42px sparkline is decoration; 104px with axis ticks and gridlines is an
instrument.

### Never

- Nest a panel inside a panel inside a panel. Max **two** levels of container: page →
  panel, or page → panel → row.
- Wrap a single value in its own bordered box. The old collections list wrapped five stats
  in five sub-cards inside a card inside a page — four levels for five numbers.
- Reserve vertical space for absent data. `detail ?? " "` to keep tiles even height is a
  layout bug wearing a string.

---

## 4. The measure rule

> **The panel is full-bleed. The text inside it gets a measure.**

These are different things and conflating them is what produced the chat bounding box.
Prose caps at `max-w-[66ch]`; the panel containing it still spans the viewport. Never
centre a panel to achieve a reading width — cap the text and let the container be wide.

Applies to: chat transcripts, empty-state copy, tooltip bodies, inspector help text,
diagnostics messages. Does **not** apply to: tables, rows, charts, canvases — those use
every pixel.

---

## 5. Empty states

One line of plain text plus, at most, one action. `p-8` is the only place the ceiling is
reached.

```tsx
<div className="p-8 text-center">
  <p className="text-ui text-muted">No collections yet.</p>
  <Button className="mt-3">Create collection</Button>
</div>
```

Not: an illustrated card, a bordered panel inside a bordered panel, or a sentence
explaining what the feature is for. And **never** an empty panel that occupies its full
loaded height with a centred message — the old dashboard had a full-height "Recent chats"
card whose entire content was a suggestion to start a chat.

---

## 6. Text you must not write

The console's failure mode is decorative copy. Delete on sight:

| Pattern | Real example from this repo |
|---|---|
| An eyebrow restating the list | `COLLECTION` stamped above every collection in a list of collections |
| A placeholder for absent optional data | `"No description yet."` |
| A greeting | `Welcome back, {name}.` |
| A subhead narrating the UI | `Pick a collection to dive into documents, search, and pipeline settings` |
| A label strip naming things the screen isn't about | a decorative pipeline-stage dot row on a settings page |

Keep text that tells the user something the UI cannot show: a constraint, a consequence,
where a value came from. `"Overlap is a stride inside the window, not extra tokens the
embedder sees"` earns its place. `"Your collections"` above a list of collections does not.

---

## 7. Loading and error

- **Loading is a skeleton at the content's final geometry.** Same row height, same column
  widths. Data landing then causes zero reflow, which is what actually reads as fast.
- **Never** a spinner centred in a `p-8` panel. That panel is a different size than the
  content replacing it, so every load ends in a visible jump.
- Errors render in place, in `text-data-neg`, with the request id available via
  `getRequestId(err)` so a user can quote a support reference.

---

## 8. Primitives — use them, never re-roll

| Need | Component |
|---|---|
| console chrome | `AppShell` |
| breadcrumb + state + actions | `CrumbBar` |
| a bordered container | `Panel` |
| adjacent panels | `PanelGrid` |
| a KPI row | `KpiStrip` |
| a time-series | `ChartPanel` |
| a list entity | `DataRow` |
| selected-item fields | `Inspector` |
| loading placeholder | `Skeleton` |
| overlay of any kind | `ModalOverlay` |
| form control | `Field` / `TextInput` / `Select` / `TextArea` + `inputClass` |
| dropdown selection | `CustomSelect` — never a native `<select>` |
| confirmation | `ConfirmDialog` |
| wizard | `WizardShell` + `WizardFooter` |

`GlassCard` and `.glass-panel` are **landing-only** now — `backdrop-filter: blur(18px)`
plus `shadow-elevation-2` on a data panel is both the wrong look and a real compositing
cost on a page with thirty of them.

---

## 9. Quality floor

Part of "done", not polish:

- `focus-visible:ring-2 ring-accent-violet ring-offset-canvas` on every interactive element.
- `aria-label` on every icon-only button — the rail is entirely icon-only.
- Keyboard: anything clickable is reachable and activatable. Test with `user-event`, not
  `fireEvent`, when focus or keyboard semantics matter.
- No horizontal page scroll. Wide content (tables, canvases) scrolls inside its own
  `overflow-x-auto` container.
- Both structural modes verified (dark + light).
- `prefers-reduced-motion` honoured — see `motion.md`.
- Never nest a `<button>` inside a clickable row; use a `role="button"` div with keyboard
  activation (`FileGridView` is the pattern). Nested buttons are invalid HTML and shipped
  as a hydration error here once.
