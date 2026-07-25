"use client";

import { cn } from "@/lib/utils";

type MeterProps = {
  /** Share of the track filled, 0–1. Clamped. */
  value: number;
  /**
   * Accessible name. With it the bar is a `progressbar`; without it the bar is
   * hidden from assistive tech — for the decorative case where the value it
   * draws is already printed as text beside it.
   */
  label?: string;
  /** Real-unit progress (`3/51`) instead of a percentage. Both or neither. */
  valueNow?: number;
  valueMax?: number;
  /** Spoken value, when the numbers alone would mislead. */
  valueText?: string;
  /** Animate width changes — live progress only, per the motion doctrine. */
  animate?: boolean;
  /** Fill token class. Series for measurements; accent for live processes. */
  fillClassName?: string;
  /** Track sizing/placement (height, width, margins). */
  className?: string;
};

/**
 * The console's determinate meter: a hairline-height rounded track with a
 * token-coloured fill. One implementation so score bars, coverage bars, and
 * progress bars stay the same instrument everywhere.
 *
 * Spans (block-styled) rather than divs so a meter can sit inside a
 * button-shaped row without invalid phrasing content.
 */
export function Meter({
  value,
  label,
  valueNow,
  valueMax,
  valueText,
  animate = false,
  fillClassName = "bg-series-1",
  className,
}: MeterProps) {
  const share = Math.max(0, Math.min(1, value));
  const semantics = label
    ? {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": valueMax ?? 100,
        "aria-valuenow": valueNow ?? Math.round(share * 100),
        "aria-valuetext": valueText,
      }
    : { "aria-hidden": true as const };

  return (
    <span
      {...semantics}
      className={cn("block h-1.5 overflow-hidden rounded-full bg-surface-strong", className)}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          animate && "transition-[width] duration-200 ease-decel motion-reduce:transition-none",
          fillClassName,
        )}
        style={{ width: `${share * 100}%` }}
      />
    </span>
  );
}
