# Ragworks UI — the token system

Every visual constant lives in `frontend/src/app/globals.css` and is exposed as a Tailwind
v4 utility through `@theme` / `@theme inline`. Components never hardcode a value. A theme
is a **values-only** edit of the token blocks — no component changes, ever.

Six families: **color & materials**, **space**, **radius**, **type**, **motion**, and
**chart series** (deliberately separate from color).

---

## 1. Space — `--spacing: 4px`

`@theme { --spacing: 4px; }` redefines Tailwind's spacing base, so the ordinary utilities
*are* the scale:

| Utility | px | Used for |
|---|---|---|
| `p-1` `gap-1` | 4 | icon↔label, chip padding |
| `p-2` `gap-2` | 8 | row padding-y, control gap |
| `p-3` `gap-3` | 12 | card padding, row padding-x, gap between cards |
| `p-4` `gap-4` | 16 | page body padding |
| `p-6` `gap-6` | 24 | between page sections |
| `p-8` `gap-8` | 32 | **ceiling** — empty states only |

**Only 1, 2, 3, 4, 6, 8 are legal.** Not 5, not 7, not 10, not 12. A scale with holes in
it stops being a scale. **The `p-8` ceiling is load-bearing** — it structurally prevents
oversized hero panels from creeping into the console.

**Why px and not rem:** density must not move when the type scale changes.

---

## 2. Radius — three values plus the pill

| Token | Utility | px | Used for |
|---|---|---|---|
| `--radius-chip` | `rounded-chip` | 4 | chips, small tags, avatar tiles |
| `--radius-control` | `rounded-control` | 6 | buttons, inputs, nav items, menu items, tabs |
| `--radius-panel` | `rounded-panel` | 10 | cards, dialogs, popovers, flyouts |

`rounded-full` is for **pills** (status/kind badges) and genuinely circular things
(avatars, the spinner). Status dots are **not** circles — they are square node dots,
`rounded-[2px]` (see `console.md`, signature marks).

**Banned:** `rounded-2xl`, `rounded-3xl`, `rounded-[2rem]` in the console. 10px is where
"product" ends and "brochure" begins.

---

## 3. Type

Root is **15px** (`html { font-size: 15px }`). Four size roles:

| Token | Utility | Size | Role |
|---|---|---|---|
| `--text-instrument` | `text-instrument` | 11px | labels, column headers, KPI captions |
| `--text-ui` | `text-ui` | 14px | body, row text, prose |
| `--text-num` | `text-num` | 15px | inline numerics |
| `--text-head` | `text-head` | 17px | section + page headings |

**The console voice is sentence case.** The voices, exactly:

```
page/section title   text-head  font-semibold tracking-[-0.01em] text-primary
row title            text-ui    font-medium   text-primary
label / caption      text-instrument font-medium text-muted        (sentence case)
column header        text-instrument font-medium text-muted        (sentence case)
meta line            text-instrument text-meta
numeric              font-mono tabular-nums                         (any size role)
identifier           font-mono                                      (verbatim, no case change)
```

**No uppercase, no letter-spacing on console labels.** The mono-uppercase-tracked
"instrument label" is the *landing* voice (`0.28em`+ there). In the console, hierarchy
comes from weight and ink, not from tracking. Mono in the console means exactly one
thing: *this is data* (a number, an id, a path, a content type).

**Dense means "no wasted space", not "small".** A tighter scale reads as zoomed-out, not
dense — do not shrink it. Hero numerics (a KPI value) use `text-[20px]`; that is the only
one-off size, and nothing exceeds it.

Two families, already loaded — **never add a font.** Geist Sans for everything; Geist
Mono for numerics, identifiers, code.

### Numerics are always mono + tabular

```
font-mono tabular-nums
```

Counts, durations, sizes, scores, token counts, dimensions — anything that can change or
sits in a column. Not optional.

---

## 4. Color & materials

Semantic tokens only. **If you are about to type a raw colour class —
`bg-[#…]`, `bg-white/10`, `text-slate-400`, `bg-violet-500` — stop and use the token.**
A raw colour is the bug that breaks every palette but the one you were looking at.

### Chrome → token

| Instead of (raw) | Use | Meaning |
|---|---|---|
| `bg-[#08070f]`, `bg-slate-950` | `bg-canvas` | page base (accent-cast per palette) |
| opaque panel, `bg-slate-900` | `bg-canvas-raised` | floating: menus, dialogs, toasts |
| `bg-white/5` | `bg-surface` | input fill, hover fill |
| `bg-white/10` | `bg-surface-strong` | stronger fill, active nav |
| `border-white/10` | `border-hairline` | structural separation |
| `border-white/30` | `border-strong` | hover/active border |
| `text-white` | `text-primary` | headings, key values |
| `text-slate-300` | `text-body` | body copy |
| `text-slate-400` | `text-muted` | labels, secondary |
| `text-slate-500` | `text-meta` | timestamps, meta |
| `text-slate-700` | `text-faint` | separators, disabled |
| `bg-violet-500` | `bg-accent-violet` | primary action, brand accent |
| `text-cyan-300` | `text-accent-cyan` | live/active, wire terminus |
| emerald / rose / amber | `data-pos` / `data-neg` / `data-warn` | semantic status |

Accent tokens take opacity like any Tailwind colour (`bg-accent-violet/10`). Hover a
filled accent with `hover:brightness-110`, never a second hardcoded shade.

### The card material — `.card-surface`

The console's depth device. One CSS class, token-driven, defined once in `globals.css`:

```css
.card-surface {
  background: linear-gradient(180deg, var(--panel-from), var(--panel-to));
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-panel);
  box-shadow: inset 0 1px 0 var(--panel-highlight), var(--elevation-1);
}
```

Lighter at the top, a 1px inner highlight along the top edge, a soft real shadow — a
machined plate under a light source. `--panel-from/-to/-highlight` and `--elevation-1`
are per-palette values (dark palettes lift with the accent cast; `paper` uses white +
a soft grey shadow). **No backdrop-filter in the console, ever** — depth is lit
gradient + highlight, never glass.

### The accent cast

Dark palettes tint their canvas, surfaces, and hairlines *toward the accent* in the token
values themselves (deep-space's hairline is violet-tinted, not white/10). This is how the
whole app reads as "lit by the brand" with zero per-component colour. Components stay
palette-blind: the cast lives only in this file's values.

### The bloom — exactly one, shell-owned

`AppShell` renders the console's single ambient bloom; no page adds another:

```css
.console-bloom::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(640px 420px at -4% -10%,
      color-mix(in srgb, var(--accent-violet) 9%, transparent), transparent 62%),
    radial-gradient(480px 320px at 104% 108%,
      color-mix(in srgb, var(--accent-cyan) 4%, transparent), transparent 62%);
}
```

`color-mix` on the accent tokens keeps it correct in every palette, including light.
Budget: ≤9% accent at the bright corner. The landing page's 22% blooms stay on the
landing page.

### The trace wire

The signature "you are here" mark — a 2px accent gradient:

```css
.trace-wire   { background: linear-gradient(180deg, var(--accent-violet), var(--accent-cyan)); }
.trace-wire-x { background: linear-gradient(90deg,  var(--accent-violet), var(--accent-cyan)); }
```

Active sidebar item edge (vertical) and active tab underline (horizontal). Nothing else.

### Elevation

`shadow-elevation-1` — the card shadow (soft, real, per-palette). `shadow-elevation-2` —
floating chrome (menus, dialogs, flyouts). `shadow-glow` — the halo for the **one**
primary action per view (`New collection`, `Upload`) and the landing CTA. Never
hand-write an rgba shadow.

### Pipeline stage colours — semantic, never reassigned

`stage-parse` `stage-chunk` `stage-embed` `stage-index` `stage-retrieve` `stage-chat`
`stage-rerank` `stage-router` `stage-neutral`, as `bg-`/`text-`/`border-`. Meaning is
fixed across every palette. For pipeline nodes/ports/edges go through
`frontend/src/components/pipelines/lib/pipeline-theme.ts` — never inline hex. SVG
`fill`/`stroke` takes tokens through inline `style` (CSS `var()` is invalid in an SVG
presentation attribute).

---

## 5. Motion tokens

Durations are bare Tailwind numerics (`duration-80` → `80ms`). Easings are tokens:

| Token | Utility | Curve | Use |
|---|---|---|---|
| `--ease-standard` | `ease-standard` | `cubic-bezier(.2,0,.2,1)` | hover, press, symmetric state |
| `--ease-decel` | `ease-decel` | `cubic-bezier(.2,0,0,1)` | things entering/revealed |
| `--ease-accel` | `ease-accel` | `cubic-bezier(.4,0,1,1)` | things leaving, decaying washes |

| Duration | Trigger |
|---|---|
| 80ms | pointer feedback — hover, press, focus |
| 120ms | overlay/flyout appearing, route fade |
| 140ms | discrete state — toggle, a value that changed |
| 160ms | something the user moved — tab wire slide, drawer |
| 200ms | layout reflow — **ceiling for everything but the pulse** |

The named console animations (`.console-enter`, `.skeleton`, `.value-tick`,
`.row-arrive`, `.console-flyout`, `.pulse-beam`) live in `globals.css`; the doctrine —
including the pulse's exclusive licence — is `motion.md`. All no-op under reduced motion.

---

## 6. Chart series — a separate family from accents

```
--series-1 … --series-6
```

**A UI accent and a chart series are different jobs, so they are different tokens.**
Measured: on the dark canvas `--accent-cyan: #22d3ee` is L 0.797 in OKLab — outside the
0.43–0.77 categorical band — so beside violet it out-shines its peer. `#0ea5b7` passes.

- Charts read `--series-*`. Chrome reads `--accent-*`. Neither substitutes.
- Series hues are assigned in fixed order; colour follows the entity, never its rank. A
  category set with no ceiling (one slot per document) cycles the six rather than
  generating a hue outside the validated band — see `data-display.md` §4 for the two
  conditions that makes honest.
- `data-pos/neg/warn` are reserved for status, never "series 4".
- Every palette's series slots are validated in CI (`palette-contract.test.ts`).

---

## 7. Palettes

Seven shipped palettes, each a values-only block:

| Palette | Structural mode | Note |
|---|---|---|
| `deep-space` | dark | default — violet cast |
| `midnight` | dark | indigo cast |
| `true-black` | dark | OLED; cast nearly neutral |
| `graphite` | dark | lifted, lower contrast |
| `high-contrast` | dark | WCAG AAA text |
| `paper` | light | default — white cards, grey shadows |
| `linen` | light | warm canvas |

**Every identity device must survive a palette swap.** The cast, the card material, the
bloom, the wire, the glow — all read accent/material tokens, so a future palette that
swaps violet for emerald keeps the entire language intact. Designing "for violet" instead
of "for `--accent-violet`" is the bug this section exists to stop.

Palettes resolve to two structural modes (dark/light) — verify those two visually; the
per-palette values are checked mechanically. Two document attributes, both written
pre-paint by `src/lib/theme-script.ts` and owned after hydration by the theme provider:
`data-theme` is the resolved MODE (`dark`/`light` — what the logo swap and mode-scoped
CSS key on), `data-palette` is the user's palette for that mode (picked per mode in
Settings → Appearance, stored per browser). Anything observing theme changes watches
BOTH attributes. Adding a palette = one values-only diff block in `globals.css` (after
both mode bases — source order is what lets it win) + one entry in `src/lib/palettes.ts`
(the catalog the picker renders from; its swatch hexes are pinned to the CSS by
`palette-contract.test.ts`). Never read a colour with `getComputedStyle`, never cache a
resolved theme.

---

## 8. The one-line test

Grep your console diff:

```bash
grep -nE "rounded-(2xl|3xl|\[2)|bg-white/|text-slate-|border-white/|text-(3|4|5)xl|p-(5|7|10)\b|tracking-\[0\.(1|2|3)|uppercase|backdrop-blur|#[0-9a-fA-F]{3,8}\b" <files>
```

Any hit is a token you skipped or a voice you broke (hex literals are allowed only in
`globals.css`, `pipeline-theme.ts`, the palette swatches in `lib/palettes.ts`, and
provider brand icons; `uppercase` is allowed only under `components/landing/` and
`app/auth/`).
