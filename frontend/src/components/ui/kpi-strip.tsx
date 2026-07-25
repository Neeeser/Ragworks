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
    <div
      className={cn(
        "card-surface grid auto-cols-fr grid-flow-col",
        "[&>*]:border-r [&>*]:border-hairline [&>*:last-child]:border-r-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

type KpiCellProps = {
  label: string;
  /** `null`/`undefined` renders an em-dash — never a misleading 0. */
  value?: number | string | null;
  /** Rendered smaller and muted inside the value, not as a separate label. */
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
              {unit ? <span className="text-num text-muted">{unit}</span> : null}
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

  if (!tooltip) return cell;
  // The trigger wraps the whole cell (block, so it fills its strip column and
  // keeps the seam on itself); focus events from an inner link bubble, so a
  // keyboard user still gets the description.
  return (
    <Tooltip content={tooltip} triggerElement="div" triggerClassName="block">
      {cell}
    </Tooltip>
  );
}
