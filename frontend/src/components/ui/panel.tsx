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

/**
 * Adjacent panels separated by a shared 1px seam rather than a gap.
 *
 * Seams read as one instrument with regions; gapped cards read as unrelated
 * widgets that happen to be adjacent, and cost double the separation pixels.
 * Children get their own right seam except the last in each row.
 */
export function PanelGrid({
  className,
  columns = 2,
  ...props
}: HTMLAttributes<HTMLDivElement> & { columns?: number }) {
  return (
    <div
      className={cn(
        "grid border-b border-hairline",
        "[&>*]:border-r [&>*]:border-hairline [&>*:last-child]:border-r-0",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
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
