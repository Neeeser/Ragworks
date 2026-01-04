"use client";

import { ArrowLeft, Files, Gauge, ScatterChart, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { Collection } from "@/lib/types";

type CollectionView = "overview" | "search" | "documents" | "visualize";

type CollectionSidebarProps = {
  collection: Collection | null;
  activeView: CollectionView;
  onSelectView: (view: CollectionView) => void;
};

const navItems: Array<{
  id: CollectionView;
  label: string;
  description: string;
  icon: typeof Gauge;
}> = [
  {
    id: "overview",
    label: "Overview",
    description: "Vitals and pipeline bindings.",
    icon: Gauge,
  },
  {
    id: "search",
    label: "Search",
    description: "Run retrieval queries.",
    icon: Search,
  },
  {
    id: "documents",
    label: "Documents",
    description: "Inspect ingested sources.",
    icon: Files,
  },
  {
    id: "visualize",
    label: "Visualize",
    description: "Explore the embedding map.",
    icon: ScatterChart,
  },
];

export function CollectionSidebar({
  collection,
  activeView,
  onSelectView,
}: CollectionSidebarProps) {
  const router = useRouter();

  return (
    <GlassCard className="rounded-3xl border border-white/10 p-5">
      <button
        type="button"
        onClick={() => router.push("/collections")}
        className="flex w-full items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-white/30 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to collections
      </button>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Collection</p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          {collection?.name || "Loading..."}
        </h2>
        <p className="text-sm text-slate-400">
          {collection?.description?.trim() || "No description yet."}
        </p>
      </div>

      <div className="mt-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={cn(
                "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
                isActive
                  ? "border-violet-400 bg-violet-500/10 text-white"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30",
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 text-violet-300" />
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-xs text-slate-400">{item.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </GlassCard>
  );
}

export type { CollectionView };
