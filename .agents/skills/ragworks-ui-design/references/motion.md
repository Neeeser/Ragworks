# Motion — "follows the pointer, never the data"

One sentence carries the whole doctrine:

> **Motion responds to what the user did. It never announces what the data did.**

This is the doctrine dense developer tools converge on, and it is why they feel fast.
A staggered list entrance is a marketing-site pattern; a chart that draws itself in delays
the moment the number can be read. Animate chrome and interaction. Leave data alone.

---

## 1. The table

| Trigger | Duration | Easing | What moves |
|---|---|---|---|
| Pointer feedback | `duration-80` | `ease-standard` | hover wash, press `translate-y-px`, focus ring |
| Discrete state | `duration-140` | `ease-standard` | toggle, tab underline, a value that changed while visible |
| Overlay appears | `duration-120` | `ease-decel` | modal/popover: opacity + `scale(.98→1)` |
| User moved it | `duration-160` | `ease-decel` | panel slide, rail collapse, drawer, drag settle |
| Layout reflow | `duration-200` | `ease-decel` | column resize, drag-to-tidy — **ceiling** |
| Route change | `duration-120` | `ease-decel` | one opacity fade on the content region — no travel, no stagger |
| **Data arriving** | **none** | — | rows, values, charts paint instantly |

Five durations. Nothing in the console exceeds 200ms. If you find yourself wanting 400ms,
the interaction is wrong, not the duration.

### Hover-opened chrome has three delays, not one

A panel that opens on hover (the rail flyouts, any future hover card) needs *intent* timing
on top of its animation, or it misfires constantly:

| Moment | Delay | Why |
|---|---|---|
| First open | **70ms** | A pointer travelling past a column of triggers would otherwise flash every panel on the way. |
| Switching, once one is open | **0** | Intent is already declared; a delay here reads as lag. |
| Leave | **120ms** | Covers the moment the pointer crosses out of the trigger toward the panel. |

Keyboard focus bypasses all three: focus is not ambiguous, so there is nothing to wait for.

And the panel must be reachable without crossing dead space — put the gap *inside* the
trigger's wrapper (`absolute left-full pl-2`) so travelling to the panel never fires the
trigger's `pointerleave`.

---

## 2. The exemption, stated precisely

**On first paint, data is static.** No fade, no rise, no stagger, no draw-in — on rows,
cells, values, charts, sparklines, tables, or trace views.

The only motion permitted on data is when a value **changes while the user is already
looking at it**:

- A number that changed: `translate-y-1` → `0` over `duration-140`. The point is to show
  *which* number moved without a full re-render flash.
- A row that just arrived (a completed run): one `data-pos/22` background wash decaying
  over 480ms with `ease-accel`. One wash, then gone.

Both are *change* indicators. Neither fires on mount.

---

## 3. Loading

**Skeleton at the content's final geometry.** Same row height, same column widths, same
count where known.

```tsx
<Skeleton className="h-2 w-32" />   // inside a row that is already 30px tall
```

`animation: shimmer 1.1s ease-in-out infinite` on opacity only — never on
`background-position`, which repaints the whole element.

**Never** a spinner centred in a padded panel. That panel is a different size than the
content that replaces it, so every load ends in a visible jump. The old console did this on
the dashboard, chat, and collections.

---

## 4. Panels slide, they never fade

A panel the user opened enters by translating from the edge it lives on
(`translate-x-full` → `0`, `duration-160 ease-decel`). Direction tells the user where it
came from and where it will return to. A fade is spatially mute — the panel appears to
materialise from nowhere and the user loses the spatial model.

The one thing that fades in is an **overlay**, because it has no edge to come from:
`opacity` + `scale(.98→1)` over `duration-120`.

---

## 5. Motion that carries information — the exception the rule protects

The pipeline playback beam and edge comet **stay**. That motion *is* data: it takes its
duration from the run's real step timing via inline `animation-duration`, so the light can
never drift from what it depicts. It is the reason the rule is phrased as "never announces
what the data did" rather than "no motion" — motion is allowed to *be* information.

If you add motion, it must be in one of two categories: a response to the pointer, or a
depiction of real data. Anything else is decoration.

---

## 6. Reduced motion

Every animation and transition no-ops under `prefers-reduced-motion: reduce`, including
infinite CSS accents like a pinging status dot (`motion-reduce:animate-none`).

Read the preference with `useSyncExternalStore`, never `useState` + effect — the latter
trips `react-hooks/set-state-in-effect` and produces a frame of wrong state.

Decorative layers carry `aria-hidden` and `pointer-events-none`.

---

## 7. Deleted from this repo, and why

| Removed | Reason |
|---|---|
| `chatBubbleFloat 6s infinite alternate` | Every chat message bobbed up and down forever — ambient motion on text being read. |
| `filter: blur(8px)` on message reveal | The most expensive property to animate, on the app's hottest path. |
| `scale(.96)` → `scale(1.01)` overshoot | A bounce on arriving text; wrong register for a workbench. |
| `landing-rise` on dashboard sections | 700ms + 22px travel + stagger, applied to *data*. Correct on the landing page, wrong here. |
| `.grid-glow` radial bloom | Decorative glow behind panels — the strongest "AI-generated" tell in the old console. |
| `duration-150/200/300/500` ad hoc | Four unrelated durations chosen per component. Replaced by the table above. |
| `animate-pulse` on loading cards | Replaced by `Skeleton` at final geometry. |

`landing-rise` and the blooms still exist and are still correct — on the landing page. See
`landing.md`. Deleting them from `(console)` is not a judgement on them; it's the two
surfaces having different jobs.
