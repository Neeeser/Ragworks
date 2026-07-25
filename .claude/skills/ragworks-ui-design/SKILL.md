---
name: ragworks-ui-design
description: Use when building, restyling, or reviewing UI in the Ragworks `frontend/` — pages, panels, forms, rows, tables, charts, empty states, modals — or when asked to "match the design", "restyle", "modernize the UI", "make it denser", or "bring this in line". Also when touching colors, typography, spacing, radii, shadows, animation, themes, or palettes; when a screen feels generic, template-like, or too spread out; and when adding any chart, KPI, or status indicator.
---

# Ragworks UI Design

Ragworks has **two UI surfaces with different jobs**, sharing one token system. Deciding
which surface you're in is the first move, because the rules genuinely conflict.

| | **Console** — `app/(console)/` | **Landing** — `components/landing/`, `app/auth/` |
|---|---|---|
| Job | stay out of the way of someone debugging | explain the tool, earn a `docker compose up` |
| Feel | dense instrument panel | atmospheric deep space |
| Read | `references/console.md` | `references/landing.md` |
| Radius | 3 / 4 / 6px | `rounded-full` CTAs, `rounded-3xl` panels |
| Glow, blooms, `GlassCard` | none | yes, one per view |
| Entrance | 120ms content fade | `landing-rise`, 700ms, staggered |
| Label tracking | `0.16em` | `0.28em`–`0.4em` |

Landing atmosphere applied to the console is what made it read as a generic SaaS dashboard.
Console density applied to the landing page makes it look unfinished. **Neither leaks.**

## Reference files

- `references/tokens.md` — **read first.** Colour, space, radius, type, motion, chart series,
  palettes, plus a grep that catches skipped tokens.
- `references/console.md` — shell, composition rule, density, measure rule, primitives.
- `references/motion.md` — the motion doctrine. Read before adding any animation.
- `references/data-display.md` — numbers, KPIs, charts, series colours, status.
- `references/landing.md` — the marketing surface.
- `references/component-recipes.md` — copy-paste snippets.

## Core principles

1. **Text is sparing.** The most common failure in this repo. No eyebrows restating the list,
   no greetings, no placeholders for absent optional data, no subheads narrating the UI. Keep
   text only where it says something the UI cannot show — a constraint, a consequence, where
   a value came from.
2. **Quiet by default, bright on purpose — but never colourless.** Saturated colour only
   where it means something, *and* it must be present: every list row and panel should carry
   at least one piece of meaning-bearing colour (a derived status dot, a stage-toned chip, a
   red failure count). A screen whose only colour is the primary button reads as unfinished,
   not restrained. See `console.md` §4.
3. **Structure is hairline.** Separation is `border-hairline` plus darkness — never shadow.
   In the console, adjacent panels share a **seam**, not a gap.
4. **Labels are instruments** — `font-mono text-instrument uppercase tracking-[0.16em]`. This
   styles labels you keep; it is not a licence to add more.
5. **Numbers are `font-mono tabular-nums`, always.**
6. **Form follows data type** — panels for state and time-series, rows for entities.
7. **Motion follows the pointer, never the data.** Data paints instantly.
8. **The subject is the decoration** — show the real product, never invented shapes.

## Copy voice

Engineering documentation, not a pitch. State facts; never narrate the UI. Sentence case,
plain verbs. **Banned:** seamless, powerful, effortless, unlock, elevate, supercharge, "dive
into", "explore", "at a glance", aphoristic taglines.

## Quick reference

```
space     p-1 p-2 p-3 p-4 p-6 p-8              → 4 8 12 16 24 32px  (only these six)
radius    rounded-chip / -control / -panel      → 3 / 4 / 6px
type      text-instrument / -ui / -num / -head  → 11 / 14 / 15 / 17px
motion    duration-80 / -120 / -140 / -160 / -200 · ease-standard / -decel / -accel
surface   bg-canvas · bg-canvas-raised · bg-surface · bg-surface-strong
border    border-hairline · border-strong
text      text-primary → text-body → text-muted → text-meta → text-faint
accent    bg-accent-violet · text-accent-cyan · data-pos / -neg / -warn
charts    --series-1 … --series-6      (never --accent-* as a series)
stages    stage-parse/chunk/embed/index/retrieve/chat/rerank/router/neutral
```

## Restyling an existing screen

In this order — the first three do most of the work and are the ones skipped:

1. **Delete text.** Eyebrows restating the list, greetings, `"No description yet."`-style
   placeholders, subheads narrating the UI. A third of the work is subtraction.
2. **Remove the page's own chrome.** Delete its title block (`CrumbBar` owns identity), its
   outer padding, and any `max-w-*`. Move real state and actions into the CrumbBar.
3. **Re-form content by data type.** Card grid of entities → `DataRow` list. Stat cards →
   one `KpiStrip`. Tall panel holding two numbers → a KPI cell plus a real `ChartPanel`.
   Nested sub-cards → deleted, their values become columns in the parent row. Collapse to at
   most two levels of container.
4. **Normalise to tokens**, then run the grep in `tokens.md`.
5. **Swap to primitives**, deleting bespoke styles.
6. **Fix loading/error** — `Skeleton` at final geometry, never a spinner in a padded panel.
7. **Motion pass** — remove every entrance on data; confirm reduced motion no-ops.

## Common mistakes

| Mistake | Why it's wrong |
|---|---|
| `rounded-2xl`/`3xl` on a data panel | Soft pill containers read as brochure, not instrument |
| A drop shadow for elevation | Separation is the hairline; shadow is the second-strongest marketing tell |
| Gapped cards where seams belong | Reads as unrelated widgets, and costs double the separation pixels |
| A spinner centred in a padded panel | Different size than the content replacing it → every load ends in a jump |
| `--accent-cyan` as chart series 2 | Measures L 0.797 on the dark canvas — out-shines violet, so peers stop reading as peers |
| A dual-axis chart | Two y-scales makes crossings meaningless. Two panels instead. |
| Proportional digits in a number column | Ragged columns; live values jitter as they re-render |
| Entrance animation on rows or charts | Delays the data. Animate chrome, not content. |
| `max-w-6xl` + page padding | Strands ~30% of the viewport; the CrumbBar makes it unnecessary |
| A value in its own bordered box | Container nesting; five stats became four levels deep once |
| A converted page with no colour but the button | State that exists in the data wasn't surfaced (`console.md` §3) |
| Shrinking type to look dense | Dense is "no wasted space", not "small" — it reads as zoomed-out |
| A hand-rolled list header with a guessed spacer | Drifts from its rows; use `DataRowHeader` |
| Dropping columns when a card becomes a row | Re-form the information, don't lose it |
| An icon-only button with no hover tooltip | The user has to click it to find out what it does |
| An icon button going where its row already goes | Duplicate target; delete the button |
| A `title="…"` attribute for a tooltip | Native tooltips can't be themed and ignore the motion system — use `Tooltip` |
| A row list directly on the canvas | Reads as loose text; give the list a `bg-canvas-raised` surface (`console.md` §3) |

## Quality floor

`focus-visible:ring-2 ring-accent-violet ring-offset-canvas` everywhere · `aria-label` on
icon-only buttons · reduced motion no-ops all animation (`useSyncExternalStore`, not
`useState`+effect) · both structural modes verified · no horizontal page scroll · never nest
a `<button>` in a clickable row (invalid HTML; shipped as a hydration error here once).

Finish with `npm run verify` in `frontend/` plus `make format-check-frontend`, then a
keyboard and reduced-motion pass, and screenshots in both modes from a seeded sandbox.

## Editing this skill

`.claude/skills/ragworks-ui-design/` and `.agents/skills/ragworks-ui-design/` must stay
byte-identical — a divergence means half the agents in this repo follow a stale language.
Author in `.claude/`, then:

```bash
rm -rf .agents/skills/ragworks-ui-design
cp -R .claude/skills/ragworks-ui-design .agents/skills/ragworks-ui-design
diff -r .claude/skills/ragworks-ui-design .agents/skills/ragworks-ui-design && echo "in sync"
```
