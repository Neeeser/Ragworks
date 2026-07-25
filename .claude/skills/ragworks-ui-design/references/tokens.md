# Ragworks UI — the token system

Every visual constant lives in `frontend/src/app/globals.css` and is exposed as a Tailwind
v4 utility through `@theme` / `@theme inline`. Components never hardcode a value. A theme
is a **values-only** edit of the token blocks — no component changes, ever.

There are five families: **color**, **space**, **radius**, **type**, **motion**. Plus a
sixth that is deliberately separate from color: **chart series**.

---

## 1. Space — `--spacing: 4px`

`@theme { --spacing: 4px; }` redefines Tailwind's spacing base, so the ordinary utilities
*are* the scale:

| Utility | px | Used for |
|---|---|---|
| `p-1` `gap-1` | 4 | icon↔label, chip padding |
| `p-2` `gap-2` | 8 | row padding-y, control gap |
| `p-3` `gap-3` | 12 | panel padding, row padding-x |
| `p-4` `gap-4` | 16 | section padding |
| `p-6` `gap-6` | 24 | between sections |
| `p-8` `gap-8` | 32 | **ceiling** — empty states only |

**Only 1, 2, 3, 4, 6, 8 are legal.** Not 5, not 7, not 10, not 12. If a layout seems to
need `p-5`, the answer is 4 or 6 — the intermediate value exists only because someone was
nudging pixels, and a scale with holes in it stops being a scale.

**The ceiling is load-bearing.** `p-8` = 32px is the most padding any element may carry.
The hero this design replaced used `py-10` on a panel inside `py-8` on a main inside a
centred `max-w-6xl`; the ceiling is what structurally prevents that from being rebuilt.

**Why px and not rem:** spacing is decoupled from the type scale on purpose. When the root
font-size changes, density must not move with it — otherwise a type tweak silently
re-lays-out every page.

---

## 2. Radius — three values

| Token | Utility | px | Used for |
|---|---|---|---|
| `--radius-chip` | `rounded-chip` | 3 | chips, badges, status pills, tags |
| `--radius-control` | `rounded-control` | 4 | buttons, inputs, rows, nodes, menu items |
| `--radius-panel` | `rounded-panel` | 6 | panels, cards, dialogs, popovers |

`rounded-full` survives **only** on things that are actually circular: status dots,
avatars, the spinner. Nothing else.

**Banned:** `rounded-2xl`, `rounded-3xl`, `rounded-[2rem]`, `rounded-[2.5rem]`. A 24px
radius on a data panel is the single strongest "marketing site" signal in a UI — soft pill
containers say *brochure*, hairline rectangles say *instrument*.

---

## 3. Type

Root is **15px** (`html { font-size: 15px }`). Four roles, and that is the whole scale:

| Token | Utility | Size | Role |
|---|---|---|---|
| `--text-instrument` | `text-instrument` | 11px | instrument labels (see below) |
| `--text-ui` | `text-ui` | 14px | body, row text, prose |
| `--text-num` | `text-num` | 15px | inline numerics |
| `--text-head` | `text-head` | 17px | section + page headings |

**Dense means "no wasted space", not "small".** This scale started a step and a half smaller
(9.5/12.5/13/14, root 13px) and read as *zoomed out* on a real screen: 9.5px labels at 0.16em
tracking are genuinely hard to read, and the tightness bought nothing, because a ten-row list
still left most of the viewport empty. Shrinking type does not create density — removing
padding, nesting, and decoration does. Do not re-tighten this.

Hero numerics (a KPI value) use `text-[20px]`; that is the only place a one-off size is
allowed, and it never exceeds 20px.

**Banned:** `text-3xl`, `text-4xl`, `text-5xl` anywhere in `(console)`. They exist in this
codebase only on the deleted dashboard hero and stat tiles.

Two families, already loaded in `app/layout.tsx` — **never add a font.** Geist Sans for
everything; Geist Mono (`font-mono`) for labels, numerics, ids, code.

### Numerics are always mono + tabular

```
font-mono tabular-nums
```

Any number that can change or that sits in a column: counts, durations, sizes, scores,
token counts, dimensions, money. Proportional digits make a column of numbers ragged and
make a changing value jitter as it re-renders. This is not optional.

### The instrument label

```
font-mono text-instrument uppercase tracking-[0.16em] text-muted
```

For any label that is not a full sentence: field labels, section kickers, column headers,
stat captions, status text, breadcrumb segments.

Instrument labels are `whitespace-nowrap` by construction — they are short by design, and a
wrapped one silently makes a column header taller than the rows beneath it.

**Tracking is `0.16em`, not `0.28em`.** The landing page uses `0.28em`–`0.4em` because
there are three labels on the whole screen and they are doing display work. In a console
with forty labels per view, wide tracking makes every one of them shout and the data
recede. Tighten it here; keep it wide there.

---

## 4. Motion

Durations are bare Tailwind numerics (`duration-80` → `80ms`). Easings are tokens:

| Token | Utility | Curve | Use |
|---|---|---|---|
| `--ease-standard` | `ease-standard` | `cubic-bezier(.2,0,.2,1)` | state changes, hover, symmetric moves |
| `--ease-decel` | `ease-decel` | `cubic-bezier(.2,0,0,1)` | things entering or being revealed |
| `--ease-accel` | `ease-accel` | `cubic-bezier(.4,0,1,1)` | things leaving, decaying flashes |

| Duration | Utility | Trigger |
|---|---|---|
| 80ms | `duration-80` | pointer feedback — hover, press, focus |
| 120ms | `duration-120` | overlay appearing |
| 140ms | `duration-140` | discrete state — toggle, tab, a value that changed |
| 160ms | `duration-160` | something the user moved — panel, rail, drawer |
| 200ms | `duration-200` | layout reflow — **ceiling for everything** |

Full doctrine, including the hard rule that **data arriving is exempt from motion**, is in
`motion.md`. Read it before adding any animation.

---

## 5. Color

Semantic tokens only. **If you are about to type a raw colour class for chrome —
`bg-[#…]`, `bg-white/10`, `text-slate-400`, `border-white/10` — stop and use the token.**
A raw colour is the bug that breaks every theme but the one you were looking at.

### Chrome → token

| Instead of (raw) | Use | Meaning |
|---|---|---|
| `bg-[#05060a]`, `bg-slate-950` | `bg-canvas` | page base |
| opaque panel, `bg-slate-900` | `bg-canvas-raised` | raised/floating: menus, dialogs, toasts |
| `bg-white/5` | `bg-surface` | panel/input fill |
| `bg-white/10` | `bg-surface-strong` | stronger fill, active nav, hover |
| `border-white/10` | `border-hairline` | structural separation |
| `border-white/30` | `border-strong` | hover/active border |
| `text-white` | `text-primary` | headings, key values |
| `text-slate-300` | `text-body` | body copy |
| `text-slate-400` | `text-muted` | labels, secondary |
| `text-slate-500` | `text-meta` | timestamps, meta |
| `text-slate-700` | `text-faint` | separators, disabled |
| `bg-violet-500` | `bg-accent-violet` | primary action, brand |
| `text-cyan-300` | `text-accent-cyan` | live/active status |
| emerald / rose / amber | `data-pos` / `data-neg` / `data-warn` | semantic status |

Accent tokens take opacity like any Tailwind colour (`bg-accent-violet/10`,
`border-accent-violet/40`). Hover a filled accent with `hover:brightness-110`, never a
second hardcoded shade.

### Elevation

`shadow-elevation-1` / `shadow-elevation-2` — a **glow** in dark palettes, a **soft
shadow** in light ones. Never hand-write an rgba shadow; it will be wrong in half the
palettes.

`shadow-glow` is reserved for the landing page's primary CTA. Console panels get **no
shadow at all** — separation is the hairline plus the darkness. A drop shadow under a data
panel is the second-strongest marketing tell after a 24px radius.

### Pipeline stage colours — semantic, never reassigned

`stage-parse` `stage-chunk` `stage-embed` `stage-index` `stage-retrieve` `stage-chat`
`stage-rerank` `stage-router` `stage-neutral`, available as `bg-`/`text-`/`border-`.

Meaning is fixed across every palette; only the step shifts for legibility. For pipeline
nodes/ports/edges go through
`frontend/src/components/pipelines/lib/pipeline-theme.ts` — never inline hex. SVG
`fill`/`stroke` must take the colour through inline `style`, because CSS `var()` is invalid
in an SVG presentation attribute.

---

## 6. Chart series — a separate family from accents

```
--series-1 … --series-6
```

**A UI accent and a chart series are different jobs, so they are different tokens.** This
is not tidiness; it came out of measuring:

> On the near-black canvas, `--accent-cyan: #22d3ee` measures **L 0.797** in OKLab —
> outside the 0.43–0.77 categorical lightness band. As a lone status dot it is perfect. As
> *series 2 beside violet* it out-shines its peer, so two equal series stop reading as
> equal. `#0ea5b7` — same hue family, one step down — passes all six checks.

Rules:

- Charts read `--series-*`. UI chrome reads `--accent-*`. Neither substitutes for the other.
- Series hues are assigned **in fixed order and never cycled**. A filter that drops a
  series must not repaint the survivors — colour follows the entity, not its rank.
- Status colours (`data-pos/neg/warn`) are **reserved** and never used as "series 4".
- Every palette's series slots are validated in CI. See `data-display.md`.

---

## 7. Palettes

Five shipped palettes, each a values-only block:

| Palette | Structural mode | Note |
|---|---|---|
| `deep-space` | dark | default |
| `true-black` | dark | OLED, max contrast |
| `graphite` | dark | lifted, lower contrast |
| `paper` | light | |
| `high-contrast` | dark | WCAG AAA text |

**Palettes resolve to two structural modes** (dark-based, light-based). This is what keeps
verification tractable: you verify the two structural modes visually, and the per-palette
token values are checked mechanically. Five full visual sweeps per change would not be
sustainable; two plus a test is.

Set on the root as `data-theme="<palette>"`, written pre-paint by the no-flash script in
`src/lib/theme-script.ts` so there is no flash and no hydration mismatch.

**Never** read a colour with `getComputedStyle` and never cache a resolved theme — tokens
are CSS variables and flip on their own.

---

## 8. The one-line test

Grep your diff:

```bash
grep -nE "rounded-(2xl|3xl|\[)|bg-white/|text-slate-|border-white/|text-(3|4|5)xl|p-(5|7|10)\b" <files>
```

Any hit is a token you skipped.
