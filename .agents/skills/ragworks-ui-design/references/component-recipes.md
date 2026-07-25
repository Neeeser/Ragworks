# Component recipes

Copy-paste starting points. Console recipes first, landing recipes at the end. Every snippet
matches the shape the real primitives in `frontend/src/components/ui/` produce — prefer
importing the primitive over pasting its markup.

---

## A console page, end to end

The canonical structure. `AppShell` comes from the layout; the page supplies its own
`CrumbBar` and a scrolling `PageBody`.

```tsx
"use client";

import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { DataRow } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";
import { StatusDot } from "@/components/ui/status-dot";

export default function CollectionsPage() {
  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Collections" }]}
        state={<InstrumentLabel>{`${collections.length} total`}</InstrumentLabel>}
        actions={
          <Button size="sm" onClick={openWizard}>
            New collection
          </Button>
        }
      />
      <PageBody>
        <KpiStrip>
          <KpiCell label="Collections" value={collections.length} />
          <KpiCell label="Documents" value={docCount} href="/collections" />
          <KpiCell label="Failed · 24h" value={failures} tone={failures ? "neg" : "pos"} />
        </KpiStrip>

        <div>
          {collections.map((collection) => (
            <DataRow
              key={collection.id}
              href={`/collections/${collection.id}`}
              leading={<StatusDot tone="pos" />}
              title={collection.name}
              columns={[
                <span className="font-mono tabular-nums">{stats.chunk_count} chunks</span>,
                <span className="font-mono tabular-nums text-meta">{timeAgo(collection.updated_at)}</span>,
              ]}
              actions={
                <Button size="sm" variant="ghost" aria-label={`Delete ${collection.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              }
            />
          ))}
        </div>
      </PageBody>
    </>
  );
}
```

Note what is **absent**: no page title block, no outer padding, no `max-width`, no wrapping
card, no `space-y-6`.

---

## The instrument label

```tsx
<InstrumentLabel>CHUNK SIZE</InstrumentLabel>
```

Raw form, when a component can't be used:

```
font-mono text-instrument uppercase tracking-[0.16em] text-muted
```

---

## Numerics

```tsx
<span className="font-mono tabular-nums text-primary">
  403<span className="text-muted">ms</span>
</span>
```

The unit is a muted span *inside* the value. Always `tabular-nums`.

---

## Panels sharing a seam

```tsx
<PanelGrid columns={2}>
  <div className="p-3">…</div>
  <div className="p-3">…</div>
</PanelGrid>
```

Hand-rolled, when the grid needs an uneven template:

```tsx
<div className="grid grid-cols-[repeat(4,1fr)_1.5fr] border-b border-hairline">
  <div className="border-r border-hairline p-3">…</div>
  <div className="border-r border-hairline p-3">…</div>
  <div className="p-3">…</div>
</div>
```

The last cell in a row has no right border. Never `gap-*` between panels.

---

## A chart panel

Plot ≥104px, three y-ticks, two x labels, crosshair on hover. Series read `--series-*`:

```tsx
<div className="p-3">
  <div className="mb-2 flex items-baseline justify-between">
    <InstrumentLabel className="text-body">PIPELINE LATENCY</InstrumentLabel>
    {/* Two or more series → a legend is always present. */}
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-chip bg-series-1" />
        <InstrumentLabel>INGEST</InstrumentLabel>
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-chip bg-series-2" />
        <InstrumentLabel>RETRIEVAL</InstrumentLabel>
      </span>
    </span>
  </div>
  <TrendChart height={104} … />
</div>
```

In SVG a token must travel through `style`, because CSS `var()` is invalid in a
`fill`/`stroke` presentation attribute:

```tsx
<path
  style={{ stroke: "var(--series-1)" }}
  strokeWidth={2}
  vectorEffect="non-scaling-stroke"
/>
```

`vectorEffect="non-scaling-stroke"` keeps a 2px line 2px wide under
`preserveAspectRatio="none"`.

---

## Status

```tsx
<StatusDot tone="pos" label="READY" />
<StatusDot tone="warn" label="1 FAILED" />
<StatusDot tone="neutral" />   {/* bare dot — only where the row already names the state */}
```

Never colour alone. Status text comes from the backend enum's `.value`.

---

## Loading

```tsx
{loading ? (
  <div className="flex items-center gap-3 px-2 py-2">
    <Skeleton className="h-1.5 w-1.5 rounded-full" />
    <Skeleton className="h-2 max-w-40 flex-1" />
    <Skeleton className="h-2 w-11" />
  </div>
) : (
  <DataRow … />
)}
```

The skeleton occupies the row's real height, so data landing shifts nothing. Never a spinner
centred in a padded panel.

---

## Empty state

```tsx
<div className="p-8 text-center">
  <p className="text-ui text-muted">No collections yet.</p>
  <Button size="sm" className="mt-3" onClick={openWizard}>
    Create collection
  </Button>
</div>
```

One line, at most one action. No panel, no illustration, no explanation of the feature.

---

## Buttons

`Button` already carries the console tokens (4px radius, `duration-80`, no glow):

```tsx
<Button size="sm">Save version</Button>
<Button size="sm" variant="secondary">Manage indexes</Button>
<Button size="sm" variant="ghost" aria-label="Delete collection">
  <Trash2 className="h-3.5 w-3.5" />
</Button>
```

Icon-only always carries `aria-label`.

---

## Forms

```tsx
<Field label="Chunk size" htmlFor="chunk-size" hint="Model max 8,191 tokens.">
  <TextInput id="chunk-size" value={value} onChange={onChange} />
</Field>
```

Never hand-write the input class string — import `inputClass`. Product dropdowns use
`CustomSelect`, never a native `<select>`, whose popup cannot follow the theme.

---

## Overlays

```tsx
<ModalOverlay open={open} onClose={close} labelledBy="dialog-title">
  <div className="w-full max-w-lg rounded-panel border border-hairline bg-canvas-raised p-4">
    <h2 id="dialog-title" className="text-head font-semibold text-primary">
      Delete collection
    </h2>
    <p className="mt-1 max-w-[66ch] text-ui text-muted">
      Purges 6 chunks from 2 indexes and 3 files from storage.
    </p>
  </div>
</ModalOverlay>
```

`ModalOverlay` owns Escape, backdrop click, focus trap, Tab containment, scroll lock, and
portalling to `document.body` — an ancestor transform creates a stacking context, so a
non-portaled overlay's `z-50` loses to the sticky chrome. Destructive confirmations use
`ConfirmDialog` (`confirmText` for type-to-confirm).

---

## A clickable row that contains a button

The trap is nesting interactive elements. `DataRow` solves it by making `actions` a sibling
of the activatable body. Hand-rolling the same shape:

```tsx
<div className="flex items-center gap-1 border-b border-hairline">
  <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">
    …
  </Link>
  <Button size="sm" variant="ghost" aria-label="Delete">…</Button>
</div>
```

If the whole row must be activatable *and* contain a button, use a `role="button"` div with
keyboard activation (`FileGridView` is the existing pattern) — never a nested `<button>`.

---

# Landing recipes

Different surface, different rules — see `landing.md`. These are link-CTAs (anchors and
`next/link`), which is why they are recipes rather than the `Button` component.

**Primary link-CTA:**

```
rounded-full bg-accent-violet px-6 py-3 text-base font-semibold text-white shadow-glow
transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
```

**Secondary link-CTA:**

```
rounded-full border border-hairline bg-surface px-6 py-3 text-base font-medium text-primary
transition hover:border-strong hover:bg-surface-strong focus-visible:outline-none
focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2
focus-visible:ring-offset-canvas
```

**The one gradient word per view:**

```tsx
<span className="bg-gradient-to-r from-grad-from via-grad-via to-grad-to bg-clip-text text-transparent">
  observability
</span>
```

**A bloom** — tokens through `color-mix` so it inverts with the palette:

```tsx
<div
  aria-hidden
  className="pointer-events-none absolute inset-0"
  style={{
    backgroundImage:
      "radial-gradient(60% 50% at 18% 12%, color-mix(in srgb, var(--accent-violet) 22%, transparent), transparent 60%)",
  }}
/>
```

**Staggered entrance:**

```tsx
<div className="landing-rise" style={{ animationDelay: "80ms" }}>
  …
</div>
```

Landing only. The console uses a single `console-enter` fade on the content region and no
entrance on data at all.
