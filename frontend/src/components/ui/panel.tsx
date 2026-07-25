"use client";

import { cn } from "@/lib/utils";

import type { HTMLAttributes } from "react";

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
 * @deprecated Landing-surface only. Console screens use `Panel`.
 *
 * Kept so the ~50 unconverted call sites keep compiling while pages migrate one
 * PR at a time, but restyled onto the console look so they improve immediately
 * rather than staying glassy until their page's turn comes.
 */
export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Panel className={className} {...props} />;
}
