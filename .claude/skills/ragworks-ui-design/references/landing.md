# The landing surface — the marketing language

Rules for `frontend/src/components/landing/` and `src/app/auth/`. **These rules are
deliberately different from the console's** (`console.md`), and neither set may leak into
the other. They share only the token system and the copy voice.

The landing page's job is to make a developer understand what Ragworks is and decide to run
it. Generosity, atmosphere, and one confident entrance are correct here. The console's job
is to get out of the way of someone debugging at 2am. Applying console density to the
landing page makes it look unfinished; applying landing atmosphere to the console makes it
read as a generic marketing dashboard.

| | Landing | Console |
|---|---|---|
| Radius | `rounded-full` CTAs, `rounded-3xl` panels | 4 / 6 / 10px + pills |
| Spacing | generous, beyond the `p-8` ceiling | scale ceiling `p-8` |
| Type | fluid display up to `text-7xl` | 11 / 14 / 15 / 17px, sentence case |
| Label voice | mono uppercase, `0.28em`–`0.4em` | sentence-case sans (mono = data only) |
| Glow / bloom | yes, one per view, up to 22% | one shell bloom ≤9% + one glowing button |
| Backdrop blur | none — landing panels are lit cards too | none |
| Entrance | `landing-rise`, 700ms, staggered | 120ms content fade |
| Atmosphere backdrop | yes | no |

---

## 1. Atmosphere — three layers

1. **Void base** — `bg-canvas`.
2. **Blooms** — two large soft radial gradients in accent colours plus a fade back to void.
   They must go through `color-mix` on the tokens so they invert with the palette:

   ```tsx
   style={{
     backgroundImage:
       "radial-gradient(60% 50% at 18% 12%, color-mix(in srgb, var(--accent-violet) 22%, transparent), transparent 60%)",
   }}
   ```

   Keep bloom opacity ≤ ~0.22 — light leaking in, not spotlights.
3. **The subject as backdrop** — the pivotal technique: render the *real* product component
   (`FlowPlayer`) faint, looping, non-interactive, masked at the edges. Never fake data,
   never real user data, never an invented abstract shape. The product's own instruments are
   more honest and more distinctive than any decoration.

Don't stack a dot grid *and* a busy backdrop.

---

## 2. Entrance

`landing-rise`: `landingRise 0.7s cubic-bezier(0.22, 1, 0.36, 1)` with a per-element
`animationDelay` (0, 80, 160, 240ms…). A confident settle, not a bounce. No-ops under
`prefers-reduced-motion`.

This is the animation the console explicitly does **not** use. Here the 700ms is doing
display work on a page with no data to delay; there it delayed the numbers.

---

## 3. Type and the accent gradient

- Headlines `font-semibold tracking-tight text-balance`, fluid
  (`text-5xl sm:text-6xl md:text-7xl` at the hero).
- Body `text-body leading-relaxed text-pretty`, `max-w-2xl`-ish measure.
- **One** element per view may take the accent gradient, and it should be a single word:

  ```
  bg-gradient-to-r from-grad-from via-grad-via to-grad-to bg-clip-text text-transparent
  ```

  Two gradient elements in a viewport and neither reads.

---

## 4. Buttons

**Primary (filled, glowing):**

```
rounded-full bg-accent-violet px-6 py-3 text-base font-semibold text-white shadow-glow
transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
```

**Secondary (hairline outline):**

```
rounded-full border border-hairline bg-surface px-6 py-3 text-base font-medium text-primary
transition hover:border-strong hover:bg-surface-strong focus-visible:outline-none
focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2
focus-visible:ring-offset-canvas
```

One small purposeful micro-interaction is allowed — a trailing arrow nudging
(`group-hover:translate-x-0.5`). Never bounce or spin.

---

## 5. Text is still sparing

The landing page gets atmosphere, **not** more copy. The principle holds identically here:
no subheads narrating an adjacent visual, no feature lists, no aphoristic taglines. A
running pipeline already says "this is a RAG pipeline." A sign-in form needs a heading and
fields — not a subhead explaining what a workspace is, and not a decorative pipeline-stage
strip. The banned register in SKILL.md's copy voice applies here unchanged.
