"use client";

import { cn } from "@/lib/utils";

import type { HTMLAttributes, ReactNode } from "react";

/**
 * The console card: the `.card-surface` material — soft vertical gradient,
 * 1px inset top highlight, hairline border, `--elevation-1` shadow.
 *
 * Depth without blur: a machined plate under a light source, cheap enough for
 * thirty per page. Adjacent cards separate with `gap-3`; rows *inside* a card
 * separate with hairlines. Never nest a card in a card.
 */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-surface", className)} {...props} />;
}

type PanelHeaderProps = {
  /** The panel's name. The one piece of text that says what the panel IS. */
  title: ReactNode;
  /** Heading id, for a `<section aria-labelledby>` wrapper. */
  id?: string;
  /** Right-aligned slot: a count, an InstrumentLabel fact, or the action. */
  end?: ReactNode;
  /** Heading level — h2 in a page section, h3 inside a titled region. */
  as?: "h2" | "h3";
  className?: string;
};

/**
 * A panel's titled header row: heading at the left, an optional fact or
 * action at the right, hairline below. One primitive because the row was
 * hand-rolled a dozen times and each copy drifted a little (items-baseline
 * here, gap-2 there) — and because on a page of stacked peer panels every
 * panel must carry a heading to be findable at all.
 */
export function PanelHeader({ title, id, end, as: Heading = "h2", className }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-2",
        className,
      )}
    >
      <Heading id={id} className="text-head font-semibold tracking-[-0.01em] text-primary">
        {title}
      </Heading>
      {end}
    </div>
  );
}

/** Column counts a single row of seamed panels supports. */
const PANEL_COLUMNS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

/**
 * One row of adjacent cards separated by the standard `gap-3`.
 *
 * Cards are objects, so neighbours get a gap, not a shared seam — the seam
 * language now lives *inside* a card (hairline-separated rows/cells). Each
 * child is expected to be a `Panel` (or carry `card-surface` itself).
 *
 * The column count is a class rather than an inline `grid-template-columns`
 * because an inline style cannot carry a breakpoint, which forced every
 * consumer to hand-roll its own responsive grid instead.
 */
export function PanelGrid({
  className,
  columns = 2,
  ...props
}: HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 | 4 }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3", PANEL_COLUMNS[columns], className)} {...props} />
  );
}

/**
 * The floating-surface material: popovers, menus, flyouts, tooltips, dialog
 * bodies. A flat raised plate — panel radius, hairline border, elevation-2 —
 * distinct from the in-page `Panel` card's lit gradient. One constant so every
 * floating layer shares the exact surface (it was hand-typed 14 times and had
 * started to drift).
 */
export const popoverSurfaceClass =
  "rounded-panel border border-hairline bg-canvas-raised shadow-elevation-2";
