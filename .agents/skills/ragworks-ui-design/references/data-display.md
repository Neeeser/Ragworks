# Numbers, charts, and status

Ragworks is an observability tool, so the data display *is* the product. This file is the
repo-specific instance of the general `dataviz` skill — when the two disagree, the general
method wins on procedure and this file wins on which tokens to feed it.

**Before building any chart, KPI row, meter, or dashboard: load the `dataviz` skill.** It
carries the form heuristic, the six colour checks, and the runnable validator. What follows
is only what is specific to Ragworks.

---

## 1. Pick the form before the colour

| The data's job | Form |
|---|---|
| one current value | KPI cell — **not a chart** |
| a value over time | line/area, ≥104px plot |
| a count per category | horizontal bars |
| a distribution (chunk sizes, scores) | histogram |
| two measures of different scale | **two panels** — never a dual axis |
| a proportion of a whole | stacked bar, never a pie/donut |

**Never a dual-axis chart.** Two y-scales is the most common dashboard mistake and it makes
crossings meaningless. "Chunks indexed" and "latency in ms" go in two panels sharing a seam,
not one clever combined chart.

---

## 2. KPI cells

```tsx
<div className="p-3">
  <div className="text-instrument font-medium text-muted">Ingest p50</div>
  <div className="mt-1 font-mono text-[20px] tabular-nums text-primary">
    403<span className="text-num text-muted">ms</span>
  </div>
</div>
```

The label is sentence-case sans (the console voice); only the value is mono.

- The unit is a smaller, muted span **inside** the value — not a separate label, and not
  baked into the number's own type size.
- Absent data is an em-dash in `text-muted`, never `0`, never `n/a`, never a blank string
  padding the row to keep heights even.
- A KPI that can be acted on is a link, so the number doubles as navigation.
- `tabular-nums` always. A KPI that updates live and isn't tabular jitters.

---

## 3. Chart panels

- Plot area **≥104px**. Below that it is a sparkline, which is decoration; above it, with
  ticks and gridlines, it is an instrument. Charts are the one element on a console page
  allowed to be generous, because they are the one element you *read*.
- Three y-ticks (min / mid / max), right-aligned, `font-mono text-[9px] text-meta`.
- Gridlines at `--border-hairline` weight or lighter. The baseline is slightly stronger than
  the interior lines.
- Two x labels only: first and last. A dense date axis on a 300px-wide panel is unreadable.
- Line weight 2px. End-point dot 3.5px with a 2px `--canvas` ring so it reads against the
  line beneath it.
- **Hover is part of the deliverable**, not a nice-to-have: crosshair + tooltip on
  line/area, per-mark tooltip on bar/cell. Hit target larger than the mark.
- **One series → no legend box**; the panel title names it. **Two or more → a legend is
  always present**, and at ≤4 series they are also directly labelled, so identity never
  rests on colour alone.
- Values and labels wear **text tokens** (`text-primary`, `text-muted`) — never the series
  colour. A coloured swatch beside the number carries identity; colouring the number itself
  fails for anyone who can't distinguish the hues.
- **Charts do not animate in.** See `motion.md` §2.

---

## 4. Series colours

Charts read `--series-1 … --series-6`, in fixed order, never cycled.

**Never use `--accent-cyan` as a chart series.** It measures L 0.797 on the near-black
canvas — outside the 0.43–0.77 categorical band — so beside violet it out-shines its peer
and two equal series stop reading as equal. This was found by running the validator, not by
looking; the eye is unreliable here and that is the whole point of the tooling.

Validated pairs currently in use:

| Mode | Series 1 | Series 2 | Result |
|---|---|---|---|
| dark (`#05060a`) | `#8b5cf6` | `#0ea5b7` | all six checks pass |
| light (`#f6f7fb`) | `#7c3aed` | `#0891b2` | all six checks pass |

To add or change a series slot in any palette:

```bash
# from the dataviz skill's base directory
node scripts/validate_palette.js "<hex,hex,…>" --mode dark  --surface "<canvas hex>"
node scripts/validate_palette.js "<hex,hex,…>" --mode light --surface "<canvas hex>"
```

Fix every `FAIL` before committing. A `WARN` on contrast obligates visible labels or a table
view — it is not dismissable. **A palette whose series slots fail does not ship**, which is
enforced by `src/lib/__tests__/palette-contract.test.ts`.

---

## 5. Status

`data-pos` / `data-neg` / `data-warn` are **reserved for state** and never reused as a
series colour. They always ship with a label or icon, never colour alone. Status renders
as a square node dot + label (`StatusDot`), or as a pill (`Chip tone dot`) where the row
has room:

```tsx
<StatusDot tone="pos" label="Ready" />
<Chip tone="pos" dot>Ready</Chip>
```

Status vocabulary derives from the backend enums — `READY`, `FAILED`, `PENDING`,
`PROCESSING` — humanised to sentence case for display (`Ready`), with the raw value kept
for tests and tooltips. Render `.value`, never a Python repr: a `DocumentStatus.READY`
reaching the UI is a backend bug, and DB-loaded enum columns arrive as raw strings so
they need normalising before `.value`.

---

## 6. Density of numbers

- Counts ≥ 1,000 get thousands separators via `toLocaleString()`.
- Durations: `<1000` → `403ms`; `≥1000` → `2.1s`. Never `2103ms`.
- Bytes through the shared formatter in `src/lib/format.ts` — never a hand-rolled `/1024`.
- Timestamps in a list are relative (`1m`, `2h`, `Jul 24`) via `formatTimeAgoCompact`;
  the absolute value goes on hover through `Tooltip`, never a `title` attribute. A column
  of full ISO timestamps is unreadable and always too wide.
- A fixed-width row column holding several spaced facts (`docs 100% queries 100%`) gets
  `whitespace-nowrap` AND a width sized to the widest real rendering (assume every
  percentage hits 100%). One step too narrow and the cell's flex items shrink, the text
  wraps at its internal spaces, and that one row renders taller than its peers — the
  evals coverage column shipped exactly this.

---

## Identifiers are not labels

A model id, index name, uuid, or file path is a **literal** — render it verbatim in
`font-mono`, with no case change and no tracking.

`Chip` carries the console's pill voice (sentence-case sans), which is right for a mode,
a version, a stage name, or a status word. Put an identifier through any label voice and
two things break at once (this shipped with the old uppercase chip):

> `anthropic/claude-3.5-haiku` renders as `ANTHROPIC/CLAUDE-3.5-HAIKU` — a string the
> API would reject — and measured **215px** instead of **172px** in a real browser, so it
> truncated inside a column that had room for it.

The tell that you have a label and not an identifier: you could translate it, or the
backend would accept it in any case. If neither is true, it is a literal.

## A chip tone that never varies is decoration

`Chip`'s dot colour has to be a function of the row's data. A `chat`-toned dot on every
row of a recent-chats list says nothing that the list's own header doesn't — it is exactly
the "colour that means something" rule failing in the other direction. Either the tone
varies with the data (status, stage, kind) or the chip should not be there.
