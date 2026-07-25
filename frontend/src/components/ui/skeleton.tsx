import { cn } from "@/lib/utils";

import type { HTMLAttributes } from "react";

/**
 * A loading placeholder sized to the content's FINAL geometry.
 *
 * Give it the height and width the real value will occupy, inside the row or
 * cell that already has its final dimensions. Data landing then causes zero
 * reflow, which is what actually reads as fast.
 *
 * This replaces the spinner-centred-in-a-padded-panel pattern: that panel is a
 * different size than the content that replaces it, so every load ended in a
 * visible jump.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton rounded-chip", className)} {...props} />;
}
