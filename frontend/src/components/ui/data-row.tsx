"use client";

import Link from "next/link";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

/**
 * Width of the trailing action slot, shared by rows and their header so the
 * columns line up by construction rather than by a hand-guessed spacer. A
 * header that guesses this drifts the moment a row gains an action.
 */
export const DATA_ROW_ACTIONS_SLOT = "w-[68px]";

/** Padding and gap shared by the header and every row body. */
const CELLS = "flex min-w-0 flex-1 items-center gap-3 px-2";

type DataRowProps = {
  /** Navigates when the row body is activated. */
  href?: string;
  /** Row-level activation when there is no destination URL. */
  onSelect?: () => void;
  /** A status dot, icon, or nothing. */
  leading?: ReactNode;
  /** The entity's name — the one piece of primary-coloured text in the row. */
  title: ReactNode;
  /**
   * A second line of genuinely useful context (a description, a config summary).
   * Omit it rather than passing a placeholder — a row that always has a subtitle
   * because absent values were filled in is taller for no information.
   */
  subtitle?: ReactNode;
  /**
   * Right-aligned metadata cells, in order. Each must carry its own width class
   * (e.g. `w-16 text-right`) matching the header's, and its own `key`. They are
   * rendered directly rather than wrapped, so the width class is the element the
   * flex row measures.
   */
  columns?: ReactNode[];
  /**
   * Buttons. Rendered as a SIBLING of the activatable body, never inside it —
   * nesting a button inside a button is invalid HTML and shipped here once as a
   * hydration error.
   */
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
};

/**
 * One entity, one row — the console's list unit.
 *
 * Entities are rows, not cards: a card grid around a list of names wastes the
 * width this design reclaimed, and forces every value into its own bordered box.
 * Metadata lives in right-aligned columns on the same line.
 */
export function DataRow({
  href,
  onSelect,
  leading,
  title,
  subtitle,
  columns = [],
  actions,
  selected = false,
  className,
}: DataRowProps) {
  const body = (
    <>
      {leading ? (
        // With a subtitle the row is two lines tall, so a centred dot lands
        // beside the second line. Pin it to the title's optical centre instead.
        <span className={cn("shrink-0", subtitle ? "self-start pt-1" : undefined)}>{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-primary">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-ui text-muted">{subtitle}</span>
        ) : null}
      </span>
      {columns}
    </>
  );

  const interactive =
    "rounded-control py-3 transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset";

  return (
    <div
      className={cn(
        "flex items-center border-b border-hairline last:border-b-0",
        selected && "bg-accent-violet/10",
        className,
      )}
    >
      {href ? (
        <Link href={href} className={cn(CELLS, interactive)}>
          {body}
        </Link>
      ) : onSelect ? (
        <button type="button" onClick={onSelect} className={cn(CELLS, interactive, "text-left")}>
          {body}
        </button>
      ) : (
        <div className={cn(CELLS, "py-3")}>{body}</div>
      )}
      <div className={cn("flex shrink-0 items-center justify-end gap-1", DATA_ROW_ACTIONS_SLOT)}>
        {actions}
      </div>
    </div>
  );
}

type DataRowHeaderProps = {
  /** The name column's label. */
  title: string;
  /**
   * One label per metadata column, each carrying the SAME width class as the
   * corresponding row column.
   */
  columns: ReactNode[];
  /** Set when rows render a `leading` slot, so the header indents to match. */
  hasLeading?: boolean;
};

/**
 * Column headers that align with `DataRow` by sharing its cell padding, gap, and
 * action-slot width.
 */
export function DataRowHeader({ title, columns, hasLeading = false }: DataRowHeaderProps) {
  return (
    <div className="flex items-center border-b border-hairline">
      <div className={cn(CELLS, "py-2")}>
        {/* Matches the row's leading dot so the name column starts level. */}
        {hasLeading ? <span className="h-1.5 w-1.5 shrink-0" aria-hidden /> : null}
        <InstrumentLabel className="min-w-0 flex-1">{title}</InstrumentLabel>
        {columns}
      </div>
      <span className={cn("shrink-0", DATA_ROW_ACTIONS_SLOT)} aria-hidden />
    </div>
  );
}

type DataRowSkeletonProps = {
  /** Placeholder row count. */
  rows?: number;
  /** Set when the real rows render a `leading` slot, so the name starts level. */
  hasLeading?: boolean;
  /**
   * One width class per metadata column, in the same order and with the SAME
   * classes as the real row's columns — those classes are what make the
   * placeholder the content's final geometry rather than an approximation.
   */
  columnWidths?: string[];
  /** What is loading. Read by screen readers; never shown. */
  label: string;
};

/**
 * `DataRow` geometry with every value replaced by a `Skeleton` bar.
 *
 * Loading is a skeleton at the content's final geometry: same row height, same
 * column widths, so data landing causes zero reflow. The alternative every list
 * reached for first — a spinner centred in a padded panel — is a different size
 * than the rows that replace it, so every load ended in a visible jump.
 *
 * Shared rather than per-list because the geometry it has to match belongs to
 * `DataRow`, so a local copy silently drifts the moment a row's padding, gap, or
 * action slot changes.
 */
export function DataRowSkeleton({
  rows = 3,
  hasLeading = false,
  columnWidths = [],
  label,
}: DataRowSkeletonProps) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center border-b border-hairline last:border-b-0">
          <div className={cn(CELLS, "py-3")}>
            {hasLeading ? <Skeleton className="h-1.5 w-1.5 rounded-full" /> : null}
            <Skeleton className="h-2 max-w-48 flex-1" />
            {columnWidths.map((width, column) => (
              <Skeleton key={`${width}-${column}`} className={cn("h-2", width)} />
            ))}
          </div>
          <span className={cn("shrink-0", DATA_ROW_ACTIONS_SLOT)} aria-hidden />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
