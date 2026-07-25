"use client";

import { ArrowUpRight, Files, Gauge, ScatterChart, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/providers/config-provider";

import type { Collection } from "@/lib/types";

const navItemClass =
  "flex w-full items-center gap-2 rounded-control px-2 py-2 text-ui font-medium transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset";
const navItemIdleClass = "text-body hover:bg-surface hover:text-primary";
const navItemActiveClass =
  "bg-accent-violet/15 text-primary ring-1 ring-inset ring-accent-violet/30";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Gauge;
  /** Match nested paths (the files tree) in addition to the exact href. */
  matchPrefix?: boolean;
};

type CollectionSidebarProps = {
  collection: Collection;
};

/**
 * Navigation for one collection. Every item is a real route — the URL always
 * says where you are; Chat studio is a separate launch action because it
 * leaves the collection section.
 */
export function CollectionSidebar({ collection }: CollectionSidebarProps) {
  const pathname = usePathname();
  const { config } = useAppConfig();
  const base = `/collections/${collection.id}`;

  const navItems: NavItem[] = [
    { href: base, label: "Overview", icon: Gauge },
    { href: `${base}/files`, label: "Files", icon: Files, matchPrefix: true },
    { href: `${base}/search`, label: "Search", icon: Search },
    { href: `${base}/diagnostics`, label: "Diagnostics", icon: ShieldAlert },
    ...(config.features.umap_visualizations === false
      ? []
      : [{ href: `${base}/visualize`, label: "Visualize", icon: ScatterChart }]),
  ];

  return (
    /* A contextual rail, not a floating card: the collection's sections are
       navigation, and the breadcrumb above already carries its identity. */
    <div className="flex w-48 shrink-0 flex-col border-r border-hairline bg-surface p-2">
      <nav aria-label="Collection" className="space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.matchPrefix
            ? pathname.startsWith(item.href)
            : pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(navItemClass, isActive ? navItemActiveClass : navItemIdleClass)}
            >
              <Icon
                className={cn("h-3.5 w-3.5", isActive ? "text-accent-violet" : "text-muted")}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-3 border-t border-hairline pt-3">
        <InstrumentLabel className="px-2">Open in</InstrumentLabel>
        <Link
          href={`/chat?collections=${encodeURIComponent(collection.id)}`}
          className={cn(navItemClass, navItemIdleClass, "mt-1 justify-between")}
        >
          Chat studio
          <ArrowUpRight className="h-3.5 w-3.5 text-muted" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
