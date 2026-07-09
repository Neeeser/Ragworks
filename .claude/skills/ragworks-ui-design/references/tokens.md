# Ragworks UI — Design tokens (the swap layer)

Every color, elevation, and data-viz hue is a **semantic design token** defined once in
`frontend/src/app/globals.css` and exposed as a Tailwind v4 utility via `@theme inline`.
Components never hardcode a color — they use the token utility. A theme (dark, light, or a
future palette) is a values-only edit of the token blocks; **no component changes**.

**The rule:** if you are about to type a raw color class for *chrome* — `bg-[#…]`,
`bg-white/N`, `bg-slate-950`, `text-slate-300`, `text-white`, `border-white/10` — stop and
use the token instead. Raw hues are reserved for genuinely semantic **data-viz** encoding,
and even those go through the stage/port tokens below, not inline hex.

## Chrome → token cheat sheet

| Instead of (raw) | Use (token utility) | Meaning |
|---|---|---|
| `bg-[#05060a]`, `bg-slate-950` | `bg-canvas` | page background |
| `bg-slate-950/90`, opaque panel | `bg-canvas-raised` (+ `/90` for scrims) | raised/floating surface, menus, toasts |
| `bg-white/5` | `bg-surface` | hairline card/input fill |
| `bg-white/10`, `bg-white/[0.08]` | `bg-surface-strong` | stronger fill, active nav |
| `border-white/10`, `border-white/5` | `border-hairline` | structural separation |
| `border-white/30`, `border-white/40` (hover) | `border-strong` | hover/active border |
| `text-white` | `text-primary` | headings, key values |
| `text-slate-300`, `text-slate-200` | `text-body` | body copy |
| `text-slate-400` | `text-muted` | labels, secondary |
| `text-slate-500` | `text-meta` | meta, timestamps, kickers |
| `text-slate-700` | `text-faint` | separators, disabled |
| `bg-violet-500`, `text-violet-300` | `bg-accent-violet`, `text-accent-violet` | primary accent |
| `bg-cyan-300`, `text-cyan-300` | `bg-accent-cyan`, `text-accent-cyan` | live/retrieval accent |
| `from-violet-300 via-fuchsia-200 to-cyan-300` | `from-grad-from via-grad-via to-grad-to` | the one gradient word |
| `shadow-lg shadow-violet-500/30` | `shadow-glow` | primary-button glow |
| `shadow-[0_18px_40px_...]` | `shadow-elevation-2` | floating elevation (glow in dark, shadow in light) |
| `bg-emerald-…` (success), `text-rose-…` (error), amber (warn) | `data-pos`, `data-neg`, `data-warn` | semantic status |

Accent utilities take opacity like any Tailwind color: `bg-accent-violet/10`,
`border-accent-violet/40`, `ring-accent-violet`. Hover a filled accent with
`hover:brightness-110` (works in both themes) rather than a second hardcoded shade.

## Data-viz → stage/port tokens

Pipeline stage colors are meaning, not chrome — never reassign them. They are tokens too,
so they deepen appropriately in light mode:

`text-stage-parse` `text-stage-chunk` `text-stage-embed` `text-stage-index`
`text-stage-retrieve` `text-stage-chat` (also `stage-rerank`, `stage-router`,
`stage-neutral`) — available as `bg-`, `text-`, `border-`.

For pipeline nodes/ports/edges, **don't hardcode** — go through
`frontend/src/components/pipelines/lib/pipeline-theme.ts`
(`getNodeFamilyStyles`, `getPortTypeClasses`, `getPortTypeColorVar`). SVG fills/strokes
must use `getPortTypeColorVar` applied via inline `style` (CSS `var()` is invalid in an SVG
`fill=`/`stroke=` presentation attribute — only in `style`).

## Theming rules (both themes are the contract)

- **Both light and dark must look right.** Verify every screen in both (toggle the
  `ThemeToggle` or set `document.documentElement.dataset.theme`). If something only works in
  dark, you used a raw color instead of a token.
- **Elevation is a token, not a fixed shadow.** Use `shadow-elevation-1/2` — glow on dark,
  soft shadow on light. Don't hand-write `shadow-[…rgba(2,6,23,…)…]`.
- **Blooms** mix an accent token over the canvas so they invert:
  `radial-gradient(…, color-mix(in srgb, var(--accent-violet) 22%, transparent), transparent 60%)`
  (via inline `style`), plus a `from-canvas to-transparent` fade.
- **Focus rings** use `ring-accent-violet` + `ring-offset-canvas` so the offset matches the
  page in either theme.
- **Never** cache a resolved theme or read a color with `getComputedStyle`; tokens flip
  automatically because they're CSS variables.
