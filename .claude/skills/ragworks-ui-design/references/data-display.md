# Numbers, charts, and status

Ragworks is an observability tool, so the data display *is* the product. This file owns
how numbers, charts, and status render in the console.

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

Charts read `--series-1 … --series-6`, assigned in fixed order.

**Never use `--accent-cyan` as a chart series.** It measures L 0.797 on the near-black
canvas — outside the 0.43–0.77 categorical band — so beside violet it out-shines its peer
and two equal series stop reading as equal. The eye is unreliable on this; trust the
validator, not a look.

The validated slots, defined once per structural mode in `globals.css` (every palette
inherits them):

| Mode | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| dark | `#8b5cf6` | `#0ea5b7` | `#bd586b` | `#ae8a0d` | `#4a710a` | `#116aac` |
| light | `#7c3aed` | `#0891b2` | `#b15d6b` | `#b18e15` | `#436416` | `#10568c` |

The set is validated **all-pairs**, not adjacent-only, because a scatter can land any two
categories side by side. That is what holds the blue at a dark step — a lighter one
collapses into series 1 under deuteranopia — and why the darkest slots sit just under 3:1
on the lifted `graphite` panel, which the rule permits only alongside visible labels.

When adding or changing a slot, check the candidate's OKLab lightness against the surface
it sits on: every series must land inside the categorical band so peers read as peers, and
low contrast obligates visible labels or a table view. **A palette whose series slots fail
does not ship** — `src/lib/__tests__/palette-contract.test.ts` pins the slots.

### An unbounded category set cycles; the legend carries identity

Six slots serve a chart whose categories are known. When the categories are *data* — one
per document, collection, or pipeline, with no ceiling — the slots cycle rather than
generating a seventh hue, because a generated colour lands wherever the arithmetic puts it
and silently leaves the validated band.

Cycling is only honest with two things in place, and both are required:

- **The slot follows a stable identifier, never rank or name** — the entity's position in
  an id-sorted list. Ordering by name repaints the whole view on a rename; ordering by
  appearance repaints it whenever the backend returns rows in a new order.
- **A legend lists every category with its swatch**, so a repeated colour is disambiguated
  by something other than colour. Per-mark hover naming the entity is the second layer.

`components/collections/detail/visualize/lib/document-series.ts` is the implementation.

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
  wraps at its internal spaces, and that one row renders taller than its peers.

---

## Paired settings state what they produce, not just their values

Two numbers whose relationship is not obvious need a line naming the result, next to
where they are edited — the reader otherwise infers the relationship, and the intuitive
inference can be the wrong one.

The worked case is chunk size and overlap (`ChunkWindowSummary`, used by the setup
wizard, the ingestion pipeline wizard, and the node editor drawer). Overlap is *added*
to the size, so a 413/83 pair sends 496 tokens to the embedder — and it is that sum, not
either field, which has to fit the model's input limit. Two number fields cannot show
that, so the summary states the arithmetic and turns red with the consequence
("split before indexing") when the sum goes over. When an expression sets either value
it says the window is decided per run rather than rendering a breakdown of placeholder
zeros: a confident false number is worse than none.

---

## Identifiers are not labels

A model id, index name, uuid, or file path is a **literal** — render it verbatim in
`font-mono`, with no case change and no tracking.

`Chip` carries the console's pill voice (sentence-case sans), which is right for a mode,
a version, a stage name, or a status word. Put an identifier through any label voice and
two things break at once: `anthropic/claude-3.5-haiku` uppercased becomes a string the
API would reject, and the case change alters its measured width, so it can truncate in a
column that had room for it.

The tell that you have a label and not an identifier: you could translate it, or the
backend would accept it in any case. If neither is true, it is a literal.

## A parameter is named twice: label first, key second

A pipeline argument or variable has both — a name a person reads and a `result_limit`
key the API accepts verbatim — and the label leads. Use `ParameterLabel` (inline, for a
control with no `Field`) or `Field`'s `label` + `labelEnd={<ParameterId …/>}`; both put
`humanizeIdentifier(name)` in the sentence-case sans label voice and the key beside it in
mono at `text-instrument text-meta`. The control's accessible name carries both, via
`parameterAccessibleName`.

The key never disappears — it is what a user quotes when the request they sent is the
thing in question — but a snake_case id standing alone as a form label hands a first-time
user a machine string where a label belongs. The same pairing carries into prose: a
sentence naming a parameter reads with the label and cites the key once inline in mono.

Authoring surfaces are the exception. In the pipeline editor's variable and IO panels the
identifier *is* the thing being edited, so it stays a bare mono literal.

## A chip tone that never varies is decoration

`Chip`'s dot colour has to be a function of the row's data. A `chat`-toned dot on every
row of a recent-chats list says nothing that the list's own header doesn't — it is exactly
the "colour that means something" rule failing in the other direction. Either the tone
varies with the data (status, stage, kind) or the chip should not be there.
