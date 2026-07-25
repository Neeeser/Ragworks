"use client";

import Image from "next/image";
import Link from "next/link";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { LucideIcon } from "lucide-react";

export type RailLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavRailProps = {
  links: RailLink[];
  /** Matched with `startsWith` so nested routes keep their section active. */
  activeHref?: string;
  /** Account menu, theme control — pinned to the bottom. */
  footer?: React.ReactNode;
};

/**
 * The 46px icon rail.
 *
 * A rail rather than a top bar because the top bar cost 70px of height and was
 * what justified the centred `max-w-6xl` that stranded a third of the viewport.
 * 46px of width is not noticed; 70px of height plus page padding is.
 *
 * Every item is icon-only, so every item carries an accessible name.
 */
export function NavRail({ links, activeHref, footer }: NavRailProps) {
  return (
    <nav
      aria-label="Sections"
      className="flex w-[46px] shrink-0 flex-col items-center gap-1 border-r border-hairline bg-surface py-2"
    >
      <Link
        href="/dashboard"
        aria-label="Ragworks console"
        className="mb-1 flex h-7 w-7 items-center justify-center rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        <span className="relative block h-5 w-6" aria-hidden>
          <Image
            src="/ragworks-mark-dark.svg"
            alt=""
            fill
            className="ragworks-mark-dark object-contain"
            unoptimized
          />
          <Image
            src="/ragworks-mark-light.svg"
            alt=""
            fill
            className="ragworks-mark-light object-contain"
            unoptimized
          />
        </span>
      </Link>

      {links.map((link) => {
        const Icon = link.icon;
        const active = activeHref?.startsWith(link.href) ?? false;
        return (
          <Tooltip key={link.href} content={link.label} side="right">
            <Link
              href={link.href}
              aria-label={link.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-80 ease-standard",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                active
                  ? "bg-accent-violet/15 text-primary ring-1 ring-inset ring-accent-violet/30"
                  : "text-muted hover:bg-surface-strong hover:text-primary",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </Link>
          </Tooltip>
        );
      })}

      {footer ? <div className="mt-auto flex flex-col items-center gap-1">{footer}</div> : null}
    </nav>
  );
}
