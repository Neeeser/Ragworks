# Ragworks UI — Component recipes

Copy-paste-ready snippets for the deep-space look. All classes are Tailwind v4 as used in
`frontend/`, and **all colors are semantic design tokens** (see `tokens.md`) so every
snippet works in both light and dark. Prefer the shared primitives (`Button`, `Field`,
`GlassCard`) where one exists; these recipes are for link-CTAs, new compositions, and the
atmosphere layers that have no primitive yet. Reference implementations live in
`frontend/src/components/landing/`.

> If you catch yourself typing a raw `bg-white/N`, `text-slate-N`, `bg-[#…]`, or
> `border-white/N` for chrome, stop — swap it for the token (`tokens.md` has the table).

## Eyebrow / section kicker (mono instrument label)

```tsx
<p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.4em] text-muted">
  <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan" aria-hidden />
  Open-source RAG workbench
</p>
```

Live/active variant with a pinging dot. The ping loops forever, so gate it with
`motion-reduce:animate-none` — infinite decorative motion must honor reduced motion just
like entrances do:

```tsx
<span className="relative flex h-1.5 w-1.5">
  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-cyan opacity-60 motion-reduce:animate-none" />
  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-cyan" />
</span>
```

## Headline with one gradient word

Spend the gradient on a single word — the rest stays `text-primary`.

```tsx
<h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-tight text-primary sm:text-6xl md:text-7xl">
  Every RAG signal,{" "}
  <span className="bg-gradient-to-r from-grad-from via-grad-via to-grad-to bg-clip-text text-transparent">
    surfaced.
  </span>
</h1>
```

## Primary CTA (filled violet, glowing) — as a link

```tsx
<Link
  href="/auth/sign-in"
  className="group flex items-center gap-2 rounded-full bg-accent-violet px-6 py-3 text-base font-semibold text-white shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
>
  Launch console
  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
</Link>
```

`text-white` stays literal here — the violet fill needs white text in both themes. For real
`<button>`s use `<Button variant="primary">` from `components/ui/button.tsx`.

## Secondary CTA (hairline outline, surface fill)

```tsx
<a
  href={GITHUB_URL}
  target="_blank"
  rel="noreferrer"
  className="flex items-center gap-2 rounded-full border border-hairline bg-surface px-6 py-3 text-base font-medium text-primary transition hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
>
  <Github className="h-4 w-4" aria-hidden />
  View source
</a>
```

## Card / panel

Prefer `GlassCard` from `components/ui/panel.tsx`. Inline equivalent:

```tsx
<div className="rounded-3xl border border-hairline bg-surface p-6">…</div>
```

## Atmosphere layers (blooms + bottom fade)

Blooms mix an accent token over the canvas (via inline `style`, since `color-mix` in an
arbitrary class is awkward) so they invert with the theme. Place behind content inside a
`relative overflow-hidden` container:

```tsx
<div className="pointer-events-none absolute inset-0" aria-hidden>
  <div
    className="absolute inset-0"
    style={{
      backgroundImage:
        "radial-gradient(60% 50% at 18% 12%, color-mix(in srgb, var(--accent-violet) 22%, transparent), transparent 60%)",
    }}
  />
  <div
    className="absolute inset-0"
    style={{
      backgroundImage:
        "radial-gradient(55% 45% at 85% 10%, color-mix(in srgb, var(--accent-cyan) 16%, transparent), transparent 60%)",
    }}
  />
  <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-canvas to-transparent" />
</div>
```

## Theme toggle

Drop `<ThemeToggle />` (`components/ui/theme-toggle.tsx`) into a top bar. It reads/writes
the theme via `useTheme()` (`providers/theme-provider.tsx`); the pre-paint script in
`app/layout.tsx` sets the initial theme with no flash. Don't build a bespoke toggle.

## Staggered entrance

`landingRise` is defined in `globals.css` and no-ops under reduced motion. Apply
`.landing-rise` and stagger with inline `animationDelay`:

```tsx
<p className="landing-rise …" style={{ animationDelay: "0ms" }}>…</p>
<h1 className="landing-rise …" style={{ animationDelay: "80ms" }}>…</h1>
<p className="landing-rise …" style={{ animationDelay: "160ms" }}>…</p>
```

## Reduced-motion preference (hydration-safe)

Never read the preference in a `useState` initializer or a `setState`-in-effect (both trip
lint / cause hydration mismatch). Use `useSyncExternalStore` — the same pattern the theme
store uses:

```tsx
function usePrefersReducedMotion(): boolean {
  const q = "(prefers-reduced-motion: reduce)";
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(q).matches,
    () => false, // server snapshot: assume motion allowed
  );
}
```

## The pipeline as ambient backdrop (signature technique)

The pivotal move: render the **real** pipeline visualization (`FlowPlayer`) faint, looping,
and non-interactive behind the hero — never a fake graphic, never real user data. It runs
on a hand-authored, in-memory synthetic graph so it works on a public/unauthenticated page
with zero network calls.

- `FlowPlayer` accepts `ambient` (hides controls, disables interaction, loops) and
  `autoPlay`. Feed it `nodes`/`edges`/`steps` you build in a small pure module (see
  `frontend/src/components/landing/lib/demo-flow.ts` for the reference synthetic graph).
- Wrap it in a masked, low-opacity, `aria-hidden` layer so it fades at the edges and clears
  the copy:

```tsx
<div
  aria-hidden
  className="pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(105%_42%_at_50%_50%,black_45%,transparent_85%)]"
>
  <FlowPlayer nodes={nodes} edges={edges} steps={steps} ambient autoPlay={!prefersReducedMotion} />
</div>
```

- Leave a **clear band** in the hero layout for the flow to run through, so nodes never sit
  under a line of text (the landing hero inserts a `h-24 sm:h-32` spacer for exactly this).
- Because it's the same component the trace viewer uses, improvements to the pipeline
  visuals flow to both places automatically. Keep it that way — don't fork a "landing-only"
  copy.

For a non-pipeline screen that still wants a living backdrop, reuse whatever real component
tells that screen's story (a trace graph, a chart) at low opacity — the principle is
"show the product faintly," not "add abstract motion."
