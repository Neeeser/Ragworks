"use client";

import Link from "next/link";

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
  /** Page-level actions, including the page's ONE glowing primary button. */
  actions?: ReactNode;
  className?: string;
};

/** The square node dot that precedes each crumb — a tiny pipeline node. */
function CrumbNode({ current }: { current: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-[7px] w-[7px] shrink-0 rounded-[2px]",
        current
          ? "bg-accent-violet shadow-[0_0_8px] shadow-accent-violet/60"
          : "bg-accent-violet/40",
      )}
    />
  );
}

/** The short wire joining two crumbs. */
function CrumbWire() {
  return (
    <span
      aria-hidden
      className="h-px w-5 shrink-0 bg-gradient-to-r from-accent-violet/40 to-accent-violet/15"
    />
  );
}

/**
 * The console's 48px top bar.
 *
 * The breadcrumb renders as the *breadcrumb path* — nodes on a wire, one of the
 * console's signature marks: drill-down through the app is a path, like data
 * through a pipeline. The current location's node is lit; earlier segments are
 * links. It replaces every page's own title block (~110px each, repeating the
 * nav), and spends the rest of the row on live state and the page's actions.
 */
export function CrumbBar({ crumbs, state, actions, className }: CrumbBarProps) {
  return (
    <div
      className={cn(
        "relative flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-4",
        className,
      )}
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
              {index > 0 ? <CrumbWire /> : null}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="flex min-w-0 items-center gap-2 rounded-control text-ui text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  <CrumbNode current={false} />
                  <span className="truncate">{crumb.label}</span>
                </Link>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-2"
                  aria-current={isLast ? "page" : undefined}
                >
                  <CrumbNode current={isLast} />
                  <span
                    className={cn(
                      "truncate text-ui",
                      isLast ? "font-medium text-primary" : "text-muted",
                    )}
                  >
                    {crumb.label}
                  </span>
                </span>
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
