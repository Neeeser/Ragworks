"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Files,
  Gauge,
  ScatterChart,
  Search,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/providers/config-provider";

import type { Collection } from "@/lib/types";

const navItemClass =
  "flex w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
const navItemIdleClass = "border-transparent text-body hover:bg-surface hover:text-primary";
const navItemActiveClass = "border-accent-violet/40 bg-accent-violet/10 text-primary";

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
    <GlassCard className="flex flex-col rounded-3xl border border-hairline p-5">
      <Link
        href="/collections"
        className="flex items-center gap-2 text-sm text-muted transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas rounded-lg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Collections
      </Link>

      <div className="mt-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Collection</p>
        <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-primary">
          {collection.name}
        </h2>
      </div>

      <nav aria-label="Collection" className="mt-6 space-y-1">
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
                className={cn("h-4 w-4", isActive ? "text-accent-violet" : "text-muted")}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-hairline pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Open in</p>
        <Link
          href={`/chat?collections=${encodeURIComponent(collection.id)}`}
          className={cn(
            navItemClass,
            "mt-2 justify-between border-hairline bg-surface text-body hover:border-strong hover:text-primary",
          )}
        >
          Chat studio
          <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden />
        </Link>
      </div>
    </GlassCard>
  );
}
