"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

/** How many models a provider can hold and still be worth opening by default. */
export const SMALL_PROVIDER_LIMIT = 8;

export interface ProviderDrawerProps {
  connectionLabel: string;
  providerType: string;
  /** Models shown inside the drawer right now (after search and filters). */
  shownCount: number;
  /** Models the provider holds in total, when a filter is narrowing the list. */
  totalCount: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * One provider's section of the catalog, collapsed to a single row until
 * opened.
 *
 * A connection publishing three hundred models otherwise buries every other
 * provider below the fold, so the count moves onto the head and the rows stay
 * behind a disclosure. When a search is narrowing the list the head reads
 * "4 of 312", because a bare "4" hides how much the search excluded.
 */
export function ProviderDrawer({
  connectionLabel,
  providerType,
  shownCount,
  totalCount,
  open,
  onToggle,
  children,
}: ProviderDrawerProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const count = shownCount === totalCount ? `${totalCount}` : `${shownCount} of ${totalCount}`;
  return (
    <div className="overflow-hidden rounded-control border border-hairline">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 bg-surface px-3 py-2 text-left transition-colors duration-80 ease-standard",
          "hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <Chevron className="h-3 w-3 shrink-0 text-meta" aria-hidden />
        <ProviderIcon providerType={providerType} className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-body">
          {connectionLabel}
        </span>
        <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">{count}</span>
      </button>
      {open ? <div className="space-y-1 p-1">{children}</div> : null}
    </div>
  );
}
