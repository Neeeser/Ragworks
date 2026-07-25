# Motion — "follows the pointer, never the data"

Two sentences carry the whole doctrine:

> **Motion responds to what the user did. It never announces what the data did.**
> **The one exception is the pulse — motion that *is* the data flowing.**

Subtle and snappy: motion you feel but never watch. A staggered list entrance is a
marketing-site pattern; a chart that draws itself in delays the number. Animate chrome
and interaction; leave data alone; let live processes pulse.

---

## 1. The table

| Trigger | Duration | Easing | What moves |
|---|---|---|---|
| Pointer feedback | `duration-80` | `ease-standard` | hover wash, press `scale(.98)` on buttons, focus ring |
| Overlay/flyout appears | `duration-120` | `ease-decel` | opacity + `scale(.98→1)`, transform-origin at the trigger |
| Discrete state | `duration-140` | `ease-standard` | toggle, a value that changed while visible |
| Tab change | `duration-160` | `ease-decel` | the `.trace-wire-x` underline *slides* to the new tab; new content fades up 2px in 120ms |
| User moved it | `duration-160` | `ease-decel` | panel slide, drawer, drag settle |
| Layout reflow | `duration-200` | `ease-decel` | column resize — **ceiling** |
| Route change | `duration-120` | `ease-decel` | one opacity fade on the content region — no travel, no stagger |
| **Data arriving** | **none** | — | rows, values, charts paint instantly |
| **The pulse** | process-timed | linear | see §2 |

Nothing in the console exceeds 200ms except the pulse, whose duration is the process's
own. If you want 400ms, the interaction is wrong, not the duration.

### Hover-opened chrome has three delays, not one

| Moment | Delay | Why |
|---|---|---|
| First open | **70ms** | a pointer travelling past a column of triggers must not flash every panel |
| Switching, once open | **0** | intent is declared; a delay reads as lag |
| Leave | **120ms** | covers the pointer crossing from trigger to panel |

Keyboard focus bypasses all three. The gap between trigger and panel lives *inside* the
trigger's wrapper (`absolute left-full pl-2`) so travel never fires `pointerleave`.

---

## 2. The pulse — the licensed exception

The pulse is the console's expressive signature (see `console.md` §3), and its licence
is exact: **it runs only while a real process is producing or moving data**, and stops
the moment the process does.

- **Ingestion**: the file's stage strip fills wire-by-wire as stages complete; the
  status pill narrates the current stage. Driven by real status transitions, never a
  looping fake.
- **Streaming / running**: a `.pulse-track` wire (2px, accent at 18%) with a
  `.pulse-beam` gradient light (violet→cyan) travelling it, ~1.6s linear loop, while
  tokens stream or a run executes.
- **Pipeline playback**: the node beam + edge comet in the editor/trace viewer — the
  same signature at full scale. Their durations come from the run's real step timing via
  inline `animation-duration`, so the light can never drift from what it depicts. They
  stay.

Never: a pulse on an idle row, a pulse as a loading spinner substitute, a pulse to make
a page "feel alive". An idle pulse is a lie, and every false pulse spends the real ones'
meaning.

---

## 3. Data — static on first paint

No fade, no rise, no stagger, no draw-in — on rows, cells, values, charts, tables, or
trace views. The only motion permitted on data is when a value **changes while the user
is already looking at it**:

- A number that changed: `.value-tick` (4px rise, 140ms).
- A row that just arrived (a completed run): one `.row-arrive` wash decaying over 480ms.

Both are *change* indicators. Neither fires on mount.

---

## 4. Loading

**Skeleton at the content's final geometry** — same row height, same column widths, same
count where known. The shimmer is **directional** (left→right, the signal direction): a
translating gradient overlay animated on `transform` only, never `background-position`
(which repaints the element).

Never a spinner centred in a padded panel — that panel is a different size than the
content replacing it, so every load ends in a visible jump.

---

## 5. Panels slide, overlays scale-fade

A panel the user opened enters by translating from the edge it lives on
(`translate-x-full → 0`, 160ms decel) — direction tells the user where it came from. An
**overlay** (modal, menu, flyout) has no edge, so it scale-fades: `opacity` +
`scale(.98→1)` over 120ms, transform-origin at its trigger.

---

## 6. Reduced motion

Every animation and transition no-ops under `prefers-reduced-motion: reduce`, including
the pulse and any infinite accent (`motion-reduce:animate-none`). The static indicators
(active ring, emphasized edge, status pill text) remain, so no information is lost.

Read the preference with `useSyncExternalStore`, never `useState` + effect. Decorative
layers carry `aria-hidden` and `pointer-events-none`.

---

## 7. Never in the console

Ambient/looping motion on content being read · `filter: blur()` in any animation (the
most expensive property, on the hottest path) · scale overshoot/bounce (wrong register
for a workbench) · `landing-rise` or any staggered entrance on data · durations outside
the table above · `animate-pulse` as a loading state (use `Skeleton` at final geometry).

`landing-rise` and the big blooms are correct — on the landing page (`landing.md`). The
two surfaces have different jobs.
