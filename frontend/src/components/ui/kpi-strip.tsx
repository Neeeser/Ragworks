"use client";

import Link from "next/link";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type KpiStripProps = {
  children: ReactNode;
  className?: string;
};

/**
 * A row of glance values: ONE card, cells separated by hairlines inside it.
 *
 * These are the values a user reads in a fraction of a second — they stay
 * compact on purpose so the vertical space goes to the charts, which are the
 * things on a console page that get read rather than glanced at. KPI cells
 * belong on the *owner's* page (a collection's Overview), never as an
 * aggregate strip above an entity list.
 */
export function KpiStrip({ children, className }: KpiStripProps) {
  return (
    // shrink-0 because overflow-hidden zeroes a flex item's automatic minimum
    // size: in a scrolling flex column (PageBody) a long sibling would collapse
    // the strip to its borders.
    <div className={cn("card-surface shrink-0 overflow-hidden", className)}>
      {/* One row at `lg` and up, two cells per row below it: five cells sharing
          a 375px viewport give each label ~70px, which is not a KPI, it is
          overlapping text. Every cell carries a right and bottom hairline and
          the negative margins push the outer ones past the card's clip, so the
          seams stay interior at any cell count. */}
      <div className="-mb-px -mr-px flex flex-wrap">{children}</div>
    </div>
  );
}

type KpiCellProps = {
  label: string;
  /** `null`/`undefined` renders an em-dash — never a misleading 0. */
  value?: number | string | null;
  /**
   * Rendered smaller and muted inside the value, not as a separate label, and
   * spaced off it — set flush, a word reads as part of the number ("20of 50").
   */
  unit?: string;
  tone?: "default" | "pos" | "neg" | "warn";
  /** Makes the number double as navigation. */
  href?: string;
  /**
   * What the value means when the label alone can't say (how it's computed,
   * what it covers). Wraps the whole cell so the strip's seams stay intact.
   */
  tooltip?: string;
  loading?: boolean;
};

const KPI_CELL_BOX = "grow basis-1/2 border-b border-r border-hairline sm:basis-1/3 lg:basis-0";

const TONE: Record<NonNullable<KpiCellProps["tone"]>, string> = {
  default: "text-primary",
  pos: "text-data-pos",
  neg: "text-data-neg",
  warn: "text-data-warn",
};

export function KpiCell({
  label,
  value,
  unit,
  tone = "default",
  href,
  tooltip,
  loading = false,
}: KpiCellProps) {
  const display = value === null || value === undefined ? null : value;
  const body = (
    <>
      <InstrumentLabel>{label}</InstrumentLabel>
      {loading ? (
        <Skeleton className="mt-1 h-5 w-10" />
      ) : (
        <p className={cn("mt-1 font-mono text-[20px] tabular-nums leading-none", TONE[tone])}>
          {display === null ? (
            <span className="text-muted">—</span>
          ) : (
            <>
              {typeof display === "number" ? display.toLocaleString() : display}
              {unit ? <span className="ml-1 text-num text-muted">{unit}</span> : null}
            </>
          )}
        </p>
      )}
    </>
  );

  const cell = href ? (
    <Link
      href={href}
      className="block p-3 transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
    >
      {body}
    </Link>
  ) : (
    <div className="p-3">{body}</div>
  );

  // The trigger wraps the whole cell (block, so it fills its strip column and
  // keeps the seam on itself); focus events from an inner link bubble, so a
  // keyboard user still gets the description.
  const described = tooltip ? (
    <Tooltip content={tooltip} triggerElement="div" triggerClassName="block">
      {cell}
    </Tooltip>
  ) : (
    cell
  );

  // The cell owns its box in the strip: two per row on a phone, three from
  // `sm`, one shared row from `lg`. Its own hairlines make the seams, and the
  // strip clips the ones on its outer edges.
  return <div className={KPI_CELL_BOX}>{described}</div>;
}
