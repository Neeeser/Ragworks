"use client";

import Link from "next/link";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

export type Crumb = {
  label: string;
  /** Omit on the final segment. */
  href?: string;
};

type CrumbBarProps = {
  crumbs: Crumb[];
  /**
   * Live system state — store backend, BM25 availability, connection count,
   * validity, selected range. The one place a user can always see whether the
   * system under them is healthy.
   */
  state?: ReactNode;
  /** Page-level actions. Replaces the per-page title block's button cluster. */
  actions?: ReactNode;
  className?: string;
};

/**
 * The console's 34px identity strip.
 *
 * It replaces every page's own title block. Those cost ~110px each and repeated
 * what the navigation already said; the breadcrumb says where you are in one
 * line and spends the rest of the row on state and actions.
 */
export function CrumbBar({ crumbs, state, actions, className }: CrumbBarProps) {
  return (
    <div
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-2 border-b border-hairline px-3",
        className,
      )}
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span className="text-faint" aria-hidden>
                  /
                </span>
              ) : null}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="rounded-chip transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  <InstrumentLabel>{crumb.label}</InstrumentLabel>
                </Link>
              ) : (
                <InstrumentLabel
                  className={cn("truncate", isLast && "text-body")}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                </InstrumentLabel>
              )}
            </span>
          );
        })}
      </nav>

      {state ? (
        <>
          <span className="h-3 w-px shrink-0 bg-hairline" aria-hidden />
          <div className="flex min-w-0 items-center gap-2">{state}</div>
        </>
      ) : null}

      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
