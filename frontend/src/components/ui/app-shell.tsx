"use client";

import { NavRail } from "@/components/ui/nav-rail";
import { cn } from "@/lib/utils";

import type { RailLink } from "@/components/ui/nav-rail";
import type { ReactNode } from "react";

type AppShellProps = {
  links: RailLink[];
  activeHref?: string;
  railFooter?: ReactNode;
  children: ReactNode;
  /**
   * Scroll behaviour for the content column. Pages that own their own scroll
   * regions (chat, pipelines, traces) pass `overflow-hidden`; ordinary pages
   * scroll normally. Kept as a prop rather than inferred from the route so the
   * decision stays visible at the call site.
   */
  contentClassName?: string;
};

/**
 * The console shell: a 46px icon rail plus a full-bleed content column.
 *
 * There is deliberately no `max-width` and no page padding here. The previous
 * shell centred every page in `max-w-6xl` inside `px-4 py-6 lg:px-10 lg:py-8`,
 * which spent 28% of a 1600px viewport's width and 13% of its height on
 * structure — content got 61% of the screen. This gets it to 91%.
 *
 * Pages render their own `CrumbBar` as their first child, so each page controls
 * its breadcrumb, live state, and actions without threading them through a
 * context.
 */
export function AppShell({
  links,
  activeHref,
  railFooter,
  children,
  contentClassName,
}: AppShellProps) {
  return (
    <div className="flex h-screen bg-canvas text-body">
      <NavRail links={links} activeHref={activeHref} footer={railFooter} />
      <main className={cn("flex min-w-0 flex-1 flex-col", contentClassName)}>{children}</main>
    </div>
  );
}

/**
 * The scrolling region under a `CrumbBar`.
 *
 * Keeps the breadcrumb fixed while content scrolls, so the page identity and
 * system state never scroll away from a user reading a long list.
 */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("console-enter min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
  );
}
