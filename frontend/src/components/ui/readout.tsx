import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type ReadoutProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

/**
 * A labelled value on one line: `CHUNKS 812`.
 *
 * The third form a fact takes in the console, beside the `KpiCell` (a value you
 * glance at, stacked and large) and the `DataRow` column (a value in a table).
 * This one is for a *set* of small facts about one selected thing — a file's
 * chunking configuration, an ingestion record — where a grid of bordered cells
 * would be four levels of container for six numbers and a stacked strip would be
 * six rows tall. Lay them out in a `flex flex-wrap gap-x-4 gap-y-1` row and the
 * set reads as one instrument readout.
 *
 * The value is mono and tabular because these are almost always numbers or
 * identifiers; pass a `className` when it genuinely is prose.
 *
 * To explain a value, wrap the whole `Readout` in a `Tooltip` rather than putting
 * one inside it: the value clips its own overflow, which would clip the tooltip
 * with it.
 */
export function Readout({ label, children, className }: ReadoutProps) {
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1.5", className)}>
      <InstrumentLabel>{label}</InstrumentLabel>
      <span className="truncate font-mono text-ui tabular-nums text-primary">{children}</span>
    </span>
  );
}
