"use client";

import { cn } from "@/lib/utils";

import type { HTMLAttributes } from "react";

/**
 * The console container: hairline border, 6px radius, token fill, no shadow.
 *
 * Elevation is deliberately absent. Separation comes from the hairline plus the
 * darkness of the canvas; a drop shadow under a data panel is the second
 * strongest "marketing page" signal after a large radius.
 */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-panel border border-hairline bg-surface", className)} {...props} />
  );
}

/** Column counts a single row of seamed panels supports. */
const PANEL_COLUMNS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

/**
 * One row of adjacent panels separated by a shared 1px seam rather than a gap.
 *
 * Seams read as one instrument with regions; gapped cards read as unrelated
 * widgets that happen to be adjacent, and cost double the separation pixels.
 *
 * The seam follows the axis the children are laid out on: stacked below the
 * breakpoint it is a bottom rule, side by side above it a right rule. The
 * column count is a class rather than an inline `grid-template-columns`
 * because an inline style cannot carry a breakpoint, which forced every
 * consumer to hand-roll its own responsive grid instead.
 */
export function PanelGrid({
  className,
  columns = 2,
  ...props
}: HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 border-b border-hairline",
        "[&>*]:border-b [&>*]:border-hairline [&>*:last-child]:border-b-0",
        "md:[&>*]:border-b-0 md:[&>*]:border-r md:[&>*:last-child]:border-r-0",
        PANEL_COLUMNS[columns],
        className,
      )}
      {...props}
    />
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
