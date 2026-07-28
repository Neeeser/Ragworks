"use client";

import { MobileNavBar } from "@/components/ui/mobile-nav-bar";
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
 * The console shell: the labeled sidebar (a bottom tab bar below `lg`) plus a
 * full-bleed content column, over the console's single ambient bloom
 * (`.console-bloom` — no page may add another light source).
 *
 * There is deliberately no `max-width` here. The old shell centred every page
 * in `max-w-6xl` inside heavy padding, which spent 28% of a 1600px viewport's
 * width and 13% of its height on structure — content got 61% of the screen.
 *
 * Pages render their own `CrumbBar` as their first child, so each page controls
 * its breadcrumb path, live state, and actions without threading them through
 * a context.
 */
export function AppShell({
  links,
  activeHref,
  railFooter,
  children,
  contentClassName,
}: AppShellProps) {
  return (
    // Column below lg so the bottom tab bar sits in flow under the content;
    // row at lg and up with the sidebar on the left. Exactly one of the two
    // nav surfaces renders at any width.
    <div className="console-bloom flex h-dvh flex-col bg-canvas text-body lg:h-screen lg:flex-row">
      <NavRail links={links} activeHref={activeHref} footer={railFooter} />
      <main className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", contentClassName)}>
        {children}
      </main>
      <MobileNavBar links={links} activeHref={activeHref} footer={railFooter} />
    </div>
  );
}

/**
 * The scrolling region under a `CrumbBar`. Provides the page's `p-4`; cards
 * inside separate with `gap-3`. Pages that own their own scroll regions pass
 * `p-0` and pad their panes themselves.
 *
 * Keeps the breadcrumb fixed while content scrolls, so the page identity and
 * system state never scroll away from a user reading a long list.
 */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("console-enter min-h-0 flex-1 overflow-y-auto p-4", className)}>
      {children}
    </div>
  );
}
