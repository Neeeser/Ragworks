"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import type { RailLink } from "@/components/ui/nav-rail";
import type { ReactNode } from "react";

type MobileNavBarProps = {
  links: RailLink[];
  /** Matched with `startsWith` so nested routes keep their section active. */
  activeHref?: string;
  /** Account menu, theme control — the same footer the sidebar carries. */
  footer?: ReactNode;
};

/**
 * The console's navigation below `lg`: a bottom tab bar instead of the
 * sidebar. A side rail spends a fixed slice of a phone's width on every page;
 * the bottom edge is the platform-native place for section switching and
 * costs the content nothing. Active state keeps the sidebar's signature —
 * accent fill plus the trace wire, here along the item's top edge.
 *
 * Icon-only on purpose: eight touch targets don't leave room for labels at
 * 375px, and every item carries its name as an `aria-label`.
 */
export function MobileNavBar({ links, activeHref, footer }: MobileNavBarProps) {
  return (
    <nav
      aria-label="Sections"
      className="flex shrink-0 items-stretch border-t border-hairline bg-canvas-raised pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {links.map((link) => {
        const Icon = link.icon;
        const active = activeHref?.startsWith(link.href) ?? false;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-label={link.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-12 min-w-0 flex-1 items-center justify-center transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet",
              active
                ? "bg-accent-violet/12 text-primary"
                : "text-muted hover:bg-surface-strong hover:text-primary",
            )}
          >
            {active ? (
              <span
                className="trace-wire absolute inset-x-3 top-0 h-[2px] rounded-full"
                aria-hidden
              />
            ) : null}
            <Icon className="h-5 w-5" aria-hidden />
          </Link>
        );
      })}
      {footer ? (
        <div className="flex shrink-0 items-center gap-1 border-l border-hairline px-2">
          {footer}
        </div>
      ) : null}
    </nav>
  );
}
