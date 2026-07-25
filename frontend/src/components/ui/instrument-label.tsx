import { cn } from "@/lib/utils";

import type { HTMLAttributes } from "react";

/**
 * The console's label voice: monospace, uppercase, letter-spaced.
 *
 * Used for any label that is not a full sentence — field labels, section
 * kickers, column headers, stat captions, status text. Tracking is 0.16em
 * rather than the landing page's 0.28em: with forty labels in a view, wide
 * tracking makes every one of them shout and the data recede.
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
        // instrument label is always a layout bug (a two-line column header
        // silently makes the whole header row taller than its rows).
        "whitespace-nowrap font-mono text-instrument uppercase tracking-[0.16em] text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
