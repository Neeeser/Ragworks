"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type DataRowProps = {
  /** Navigates when the row body is activated. */
  href?: string;
  /** Row-level activation when there is no destination URL. */
  onSelect?: () => void;
  /** A status dot, icon, or nothing. */
  leading?: ReactNode;
  /** The entity's name — the one piece of primary-coloured text in the row. */
  title: ReactNode;
  /** Right-aligned metadata columns, rendered in order. */
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

const BODY =
  "flex min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2 text-left transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset";

/**
 * One entity, one row — the console's list unit.
 *
 * Entities are rows, not cards: a card grid around a list of names wastes the
 * width that made this redesign worth doing, and forces a value into its own
 * bordered box. Metadata lives in right-aligned columns on the same line.
 */
export function DataRow({
  href,
  onSelect,
  leading,
  title,
  columns = [],
  actions,
  selected = false,
  className,
}: DataRowProps) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">{title}</span>
      {columns.map((column, index) => (
        // Columns are positional metadata cells with no stable identity of
        // their own; the row's own key comes from the caller's list.
        <span key={index} className="shrink-0 text-ui text-muted">
          {column}
        </span>
      ))}
    </>
  );

  return (
    <div
      className={cn(
        "group flex items-center gap-1 border-b border-hairline last:border-b-0",
        selected && "bg-accent-violet/10",
        className,
      )}
    >
      {href ? (
        <Link href={href} className={cn(BODY, "hover:bg-surface")}>
          {body}
        </Link>
      ) : onSelect ? (
        <button type="button" onClick={onSelect} className={cn(BODY, "hover:bg-surface")}>
          {body}
        </button>
      ) : (
        <div className={BODY}>{body}</div>
      )}
      {actions ? <div className="flex shrink-0 items-center gap-1 pr-2">{actions}</div> : null}
    </div>
  );
}
