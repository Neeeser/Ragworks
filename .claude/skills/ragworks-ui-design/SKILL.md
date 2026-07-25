---
name: ragworks-ui-design
description: >-
  Use when building, restyling, or reviewing UI in the Ragworks `frontend/` — pages,
  panels, forms, rows, tables, charts, empty states, modals — or when asked to "match the
  design", "restyle", "modernize the UI", "make it denser", or "bring this in line". Also
  when touching colors, typography, spacing, radii, shadows, animation, themes, or
  palettes; when a screen feels generic, template-like, or too spread out; and when adding
  any chart, KPI, or status indicator.
---

# Ragworks UI Design

Ragworks has **two UI surfaces with different jobs**, sharing one token system. Deciding
which surface you're in is the first move, because the rules genuinely conflict.

| | **Console** — `app/(console)/` | **Landing** — `components/landing/`, `app/auth/` |
|---|---|---|
| Job | a dense, inviting workbench for building RAG pipelines | explain the tool, earn a `docker compose up` |
| Feel | soft-depth product UI, lit by the accent | atmospheric deep space |
| Read | `references/console.md` | `references/landing.md` |
| Radius | 4 / 6 / 10px + pills | `rounded-full` CTAs, `rounded-3xl` panels |
| Blooms | exactly one, shell-owned, ~9% accent | yes, one per view, up to 22% |
| `GlassCard`, blur | none | yes, one per view |
| Entrance | 120ms content fade | `landing-rise`, 700ms, staggered |
| Label voice | sentence case, sans | mono uppercase, `0.28em`–`0.4em` tracking |

The console language is **soft-depth workbench**: elevated cards on an accent-cast canvas,
sentence-case type with real weight hierarchy, mono reserved for data, and three signature
marks rooted in the product — the trace wire, node dots, and the pulse. It is dense
(full-bleed, no wasted space) *and* it looks like a product, not a wireframe and not a
Grafana clone. Landing atmosphere still doesn't leak in (no glass, no giant gradients);
console density still doesn't leak out.

## Reference files

- `references/tokens.md` — **read first.** Color, materials, space, radius, type, motion,
  chart series, palettes, plus a grep that catches skipped tokens.
- `references/console.md` — shell, composition, signature marks, density, empty states.
- `references/motion.md` — the motion doctrine. Read before adding any animation.
- `references/data-display.md` — numbers, KPIs, charts, series colours, status.
- `references/landing.md` — the marketing surface.
- `references/component-recipes.md` — copy-paste snippets.

## Core principles

1. **Dense, never cramped.** Full-bleed content, no `max-width`, no page title blocks, no
   space reserved for absent data — but type stays at reading size and cards get real
   padding. Density is "no wasted space", not "small".
2. **The accent is a system, not a color.** Every branded device reads
   `--accent-violet`/`--accent-cyan` (and stage/status tokens) — never a hardcoded hue.
   Users switch palettes; the identity must survive every one of them.
3. **Light is budgeted.** One shell bloom. One glowing primary action per view. The trace
   wire only on active markers. The pulse only on live processes. Stack more light and it
   reads salesy; strip it all and it reads like a wireframe. The budget is the look.
4. **Depth without blur.** Cards are lit surfaces: soft vertical gradient, 1px inset top
   highlight, hairline border, `shadow-elevation-1`. No backdrop-filter in the console.
5. **Sentence case speaks, mono measures.** Labels, headers, and titles are sentence-case
   sans with weight hierarchy. Numbers, IDs, paths, and content types are
   `font-mono tabular-nums`. Uppercase-tracked labels are landing-only.
6. **The signature marks are product truths** — the breadcrumb is a node path because
   drill-down *is* a path; status dots are square because they're mini pipeline nodes;
   things pulse only when data is actually flowing. Never invent decoration beyond them.
7. **Motion follows the pointer, never the data** — except the pulse, which *is* data.
   Data paints instantly.
8. **Text is sparing.** No eyebrows restating lists, no greetings, no placeholders for
   absent data, no subheads narrating the UI. Keep text only where it says something the
   UI cannot show.
9. **Form follows data type** — cards for state and time-series, rows for entities.
10. **Functionality parity is a hard floor.** A restyle never drops information, actions,
    or states a page had. Re-form them; never delete them.
11. **Desktop-first, mobile-respected.** The console is built for power users on desktop
    — density decisions are made at ≥1280px and never watered down for phones. But every
    page must still *work* below `lg`: panes collapse or become overlays, toolbars wrap,
    tables scroll in their own `overflow-x-auto`, touch targets stay ≥32px. Where a
    desktop affordance can't translate (hover flyouts, drag-drop), the click/tap path
    must exist anyway — which the keyboard rules already require.

## Copy voice

Engineering documentation, not a pitch. State facts; never narrate the UI. Sentence case,
plain verbs. **Banned:** seamless, powerful, effortless, unlock, elevate, supercharge,
"dive into", "explore", "at a glance", aphoristic taglines.

## Quick reference

```
space     p-1 p-2 p-3 p-4 p-6 p-8              → 4 8 12 16 24 32px  (only these six)
radius    rounded-chip / -control / -panel      → 4 / 6 / 10px · rounded-full for pills
type      text-instrument / -ui / -num / -head  → 11 / 14 / 15 / 17px
titles    text-head font-semibold tracking-[-0.01em]   (sentence case)
labels    text-instrument font-medium text-muted        (sentence case, sans)
numbers   font-mono tabular-nums, always
motion    duration-80 / -120 / -140 / -160 / -200 · ease-standard / -decel / -accel
surface   bg-canvas · bg-canvas-raised · bg-surface · bg-surface-strong
card      Panel — gradient fill + inset highlight + hairline + shadow-elevation-1
border    border-hairline · border-strong
text      text-primary → text-body → text-muted → text-meta → text-faint
accent    bg-accent-violet · text-accent-cyan · data-pos / -neg / -warn
wire      .trace-wire — violet→cyan gradient, active markers only
pulse     .pulse-track/.pulse-beam — live processes only
charts    --series-1 … --series-6      (never --accent-* as a series)
stages    stage-parse/chunk/embed/index/retrieve/chat/rerank/router/neutral
```

## Restyling an existing screen

In this order — the first three do most of the work:

1. **Delete text.** Eyebrows restating the list, greetings, `"No description yet."`-style
   placeholders, subheads narrating the UI. A third of the work is subtraction.
2. **Remove the page's own chrome.** No page title block (the top bar's breadcrumb path
   owns identity), no `max-w-*`. Real state and actions go in the top bar.
3. **Re-form content by data type.** Entities → rows inside one `Panel`; per-entity stats
   → columns on the entity's row, never a global KPI strip; a thing's own stats → KPI
   cells on *its* page. Two container levels max: page → card → row.
4. **Normalise to tokens**, then run the grep in `tokens.md`.
5. **Swap to primitives**, deleting bespoke styles.
6. **Surface the signature marks** — breadcrumb path, square status dots, stage-strip
   metadata where a pipeline is bound, pulse on anything genuinely running.
7. **Fix loading/error** — `Skeleton` at final geometry with directional shimmer.
8. **Motion pass** — pointer/state motion per the table; no entrance on data; reduced
   motion no-ops everything.

## Common mistakes

| Mistake | Why it's wrong |
|---|---|
| `rounded-2xl`/`3xl` on a console card | 10px (`rounded-panel`) is the ceiling; softer reads brochure |
| backdrop-blur on a console surface | Depth here is the lit gradient + highlight, never glass |
| A second bloom, or a per-page bloom | The shell owns the only bloom; stacking light is the salesy failure |
| Hardcoding violet (`#8b5cf6`, `bg-violet-500`) | Breaks every non-violet palette; use `--accent-*` tokens |
| Uppercase-tracked mono labels in the console | That's the landing voice; console labels are sentence-case sans |
| Proportional digits in a number column | Ragged columns; live values jitter — `font-mono tabular-nums` |
| A global KPI strip above an entity list | Stats belong to each entity's row, or to the entity's own page |
| Round status dots | Status dots are square node dots (`rounded-[2px]`) — a signature |
| The pulse on something idle | Pulse = data flowing now; an idle pulse is a lie and dilutes the mark |
| The trace wire as a general divider | It marks "where you are" (active nav/tab) — nothing else |
| Entrance animation on rows or charts | Delays the data; animate chrome, not content |
| A dual-axis chart | Two y-scales make crossings meaningless; two cards |
| `--accent-cyan` as chart series 2 | Fails the categorical lightness band; use `--series-2` |
| A spinner centred in a padded panel | Skeleton at final geometry, or every load ends in a jump |
| `max-w-6xl` + page padding | Strands ~30% of the viewport |
| Dropping columns/actions in a redesign | Functionality parity is a hard floor — re-form, don't reduce |
| An icon-only button with no tooltip | The user has to click it to learn what it does |
| A `title="…"` attribute for a tooltip | Can't be themed, ignores motion — use `Tooltip` |
| Native `<select>` in product UI | Popup can't follow the theme — `CustomSelect` |

## Quality floor

`focus-visible:ring-2 ring-accent-violet ring-offset-canvas` everywhere · `aria-label` on
icon-only buttons · reduced motion no-ops all animation (`useSyncExternalStore`, not
`useState`+effect) · both structural modes verified (dark + light) · no horizontal page
scroll · never nest a `<button>` in a clickable row (invalid HTML; shipped as a hydration
error here once).

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
