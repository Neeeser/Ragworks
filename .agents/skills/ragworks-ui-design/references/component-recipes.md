# Component recipes

Copy-paste starting points. Console recipes first, landing recipes at the end. Every
snippet matches the shape the real primitives in `frontend/src/components/ui/` produce —
prefer importing the primitive over pasting its markup.

---

## A console page, end to end

`AppShell` comes from the layout; the page supplies its own `CrumbBar` and a scrolling
`PageBody` (which provides the `p-4`).

```tsx
"use client";

import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { DataRow, DataRowHeader } from "@/components/ui/data-row";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { StageStrip } from "@/components/ui/stage-strip";

export default function CollectionsPage() {
  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Collections" }]}
        state={<span className="text-instrument text-meta">{`${collections.length} collections`}</span>}
        actions={<Button size="sm" glow onClick={openWizard}>New collection</Button>}
      />
      <PageBody>
        <Panel>
          <DataRowHeader columns={["Docs", "Chunks", "Avg query", "Updated"]} />
          {collections.map((c) => (
            <DataRow
              key={c.id}
              href={`/collections/${c.id}`}
              leading={<StatusDot tone={toneFor(c)} />}
              title={c.name}
              meta={<StageStrip pipeline={c.pipeline} summary="hybrid · RRF · pgvector" />}
              columns={[
                <span className="font-mono tabular-nums">{stats.document_count}</span>,
                <span className="font-mono tabular-nums">{stats.chunk_count}</span>,
                <span className="font-mono tabular-nums">{latency}</span>,
                <span className="font-mono tabular-nums text-meta">{timeAgo(c.updated_at)}</span>,
              ]}
              actions={
                <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              }
            />
          ))}
        </Panel>
      </PageBody>
    </>
  );
}
```

Note what is **absent**: no page title block, no `max-width`, no aggregate KPI strip
above the list — each row carries its own numbers.

---

## The card

```tsx
<Panel>…</Panel>
```

Raw form, when the component can't be used: `className="card-surface"`. Never re-roll
the gradient/highlight/shadow by hand, and never nest a card in a card.

---

## Labels and titles (the console voice)

```tsx
<h2 className="text-head font-semibold tracking-[-0.01em] text-primary">Pipelines</h2>
<span className="text-instrument font-medium text-muted">Avg query latency</span>
```

Sentence case, sans, weight for hierarchy. No `uppercase`, no `tracking-[0.16em]`, no
mono — mono is for data only.

---

## Numerics

```tsx
<span className="font-mono tabular-nums text-primary">
  403<span className="text-muted">ms</span>
</span>
```

The unit is a muted span *inside* the value. Always `tabular-nums`.

---

## KPI cells (on the owner's page only)

```tsx
<KpiStrip>
  <KpiCell label="Documents" value={docCount} />
  <KpiCell label="Chunks" value={chunkCount} />
  <KpiCell label="Avg query latency" value={latency} unit="ms" />
  <KpiCell label="Failed · 24h" value={failures} tone={failures ? "neg" : undefined} />
</KpiStrip>
```

One card, cells separated by hairlines inside it. Labels sentence-case sans; values
`font-mono tabular-nums text-[20px]`. Absent data is an em-dash in `text-muted`.

---

## A chart card

Plot ≥104px, three y-ticks, two x labels, crosshair on hover. Series read `--series-*`:

```tsx
<Panel className="p-3">
  <div className="mb-2 flex items-baseline justify-between">
    <span className="text-instrument font-medium text-muted">Pipeline latency</span>
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-[2px] bg-series-1" />
        <span className="text-instrument text-muted">Ingest</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-[2px] bg-series-2" />
        <span className="text-instrument text-muted">Retrieval</span>
      </span>
    </span>
  </div>
  <TrendChart height={104} … />
</Panel>
```

In SVG a token travels through `style` (`var()` is invalid in a presentation attribute);
`vectorEffect="non-scaling-stroke"` keeps a 2px line 2px wide.

---

## Status

```tsx
<StatusDot tone="pos" label="Ready" />        {/* square node dot + sentence-case label */}
<Chip tone="pos" dot>Ready</Chip>             {/* pill: tinted fill, node dot, label */}
<Chip tone="neg" dot>1 error</Chip>
```

Never colour alone. Status text is the backend enum's `.value`, humanised to sentence
case in the UI (`READY` → `Ready`); the raw value stays available for tests/tooltips.

---

## Stage strip (a bound pipeline as row metadata)

```tsx
<StageStrip stages={["parse", "chunk", "embed", "index"]} summary="hybrid · RRF · pgvector" />
```

6px stage-coloured node dots joined by hairline wires plus a plain summary. Only where a
real pipeline is bound — never as decoration.

---

## The pulse (live processes only)

```tsx
<PulseWire className="w-40" />   {/* streaming response, running query/eval */}
```

Ingestion rows use the stage strip's built-in live mode: pass the document's current
status and the active wire fills while the pill narrates. Both no-op under reduced
motion (static active state remains).

---

## Loading

```tsx
{loading ? (
  <div className="flex items-center gap-3 px-3 py-2">
    <Skeleton className="h-1.5 w-1.5 rounded-[2px]" />
    <Skeleton className="h-2 max-w-40 flex-1" />
    <Skeleton className="h-2 w-11" />
  </div>
) : (
  <DataRow … />
)}
```

The skeleton occupies the row's real height; the shimmer travels left→right. Never a
spinner centred in a padded panel.

---

## Empty state

```tsx
<div className="p-8 text-center">
  <p className="text-ui text-muted">No collections yet.</p>
  <Button size="sm" glow className="mt-3" onClick={openWizard}>Create collection</Button>
</div>
```

One line, at most one action.

---

## Buttons

```tsx
<Button size="sm" glow>New collection</Button>   {/* the ONE primary per view: accent fill,
                                                     inset highlight, soft halo */}
<Button size="sm" variant="secondary">Manage indexes</Button>
<Button size="sm" variant="ghost" aria-label="Delete collection">
  <Trash2 className="h-3.5 w-3.5" />
</Button>
```

`glow` is the per-view budget item — one per view, on the primary action only.
Icon-only always carries `aria-label` and a `Tooltip`.

---

## Forms

```tsx
<Field label="Chunk size" htmlFor="chunk-size" hint="Model max 8,191 tokens.">
  <TextInput id="chunk-size" value={value} onChange={onChange} />
</Field>
```

Never hand-write the input class string — import `inputClass`. Product dropdowns use
`CustomSelect`, never a native `<select>`.

---

## Overlays

```tsx
<ModalOverlay open={open} onClose={close} labelledBy="dialog-title">
  <div className="card-surface w-full max-w-lg bg-canvas-raised p-4 shadow-elevation-2">
    <h2 id="dialog-title" className="text-head font-semibold text-primary">
      Delete collection
    </h2>
    <p className="mt-1 max-w-[66ch] text-ui text-muted">
      Purges 6 chunks from 2 indexes and 3 files from storage.
    </p>
  </div>
</ModalOverlay>
```

`ModalOverlay` owns Escape, backdrop, focus trap, scroll lock, and portalling.
Destructive confirmations use `ConfirmDialog` (`confirmText` for type-to-confirm).

---

## A clickable row that contains a button

`DataRow` makes `actions` a sibling of the activatable body. Hand-rolling the same shape:

```tsx
<div className="flex items-center gap-1 border-b border-hairline last:border-b-0">
  <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">…</Link>
  <Button size="sm" variant="ghost" aria-label="Delete">…</Button>
</div>
```

If the whole row must be activatable *and* contain a button, use a `role="button"` div
with keyboard activation (`FileGridView` is the pattern) — never a nested `<button>`.

---

# Landing recipes

Different surface, different rules — see `landing.md`. Link-CTAs (anchors), which is why
they are recipes rather than the `Button` component.

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
<div className="landing-rise" style={{ animationDelay: "80ms" }}>…</div>
```

Landing only. The console uses a single `console-enter` fade and no entrance on data.
