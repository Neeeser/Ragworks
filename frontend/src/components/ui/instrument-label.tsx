import { cn } from "@/lib/utils";

import type { HTMLAttributes } from "react";

/**
 * The console's label voice: sentence-case sans, medium weight, muted ink.
 *
 * Used for any label that is not a full sentence — field labels, column
 * headers, KPI captions, meta lines. Hierarchy comes from weight and ink, not
 * from tracking: the old mono-uppercase-tracked voice made every screen read
 * as plain text formatted on a page; it now belongs to the landing surface
 * only. Mono in the console means exactly one thing: this is data.
 *
 * This styles the labels a screen keeps. It is not a licence to add more.
 */
export function InstrumentLabel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        // nowrap by default: these labels are short by design, and a wrapped
        // label is always a layout bug (a two-line column header silently
        // makes the whole header row taller than its rows).
        "whitespace-nowrap text-instrument font-medium text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
