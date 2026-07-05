import { Database } from "lucide-react";

import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { DashboardStats } from "@/app/(console)/dashboard/use-dashboard-data";

type DashboardOverviewPanelsProps = {
  stats: DashboardStats;
  collectionCount: number;
  sessionCount: number;
};

export function DashboardOverviewPanels({
  stats,
  collectionCount,
  sessionCount,
}: DashboardOverviewPanelsProps) {
  const pipelineSteps = [
    {
      label: "Parse",
      status: "Healthy",
      detail: "Uploads flowing",
      active: true,
    },
    {
      label: "Chunk",
      status: `${stats.avgChunkSize} avg tokens`,
      detail: "Auto tuned by embedding context",
      active: true,
    },
    {
      label: "Embed",
      status: "OpenRouter",
      detail: "Stored locally + Pinecone",
      active: collectionCount > 0,
    },
    {
      label: "Chat",
      status: `${sessionCount} sessions`,
      detail: "Tool traces captured",
      active: sessionCount > 0,
    },
  ];

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <GlassCard className="rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">context</p>
            <h2 className="text-2xl font-semibold text-white">Model utilization</h2>
          </div>
          <div className="text-right text-sm text-slate-400">
            <p>{stats.contextConsumed.toLocaleString()} tokens consumed</p>
            <p>{stats.contextCapacity.toLocaleString()} reserved</p>
          </div>
        </div>
        <div className="mt-8 h-3 w-full rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all"
            style={{ width: `${stats.contextUtilization}%` }}
          />
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Average chunk size {stats.avgChunkSize} tokens
        </p>
      </GlassCard>

      <GlassCard className="rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">pipeline</p>
            <h2 className="text-2xl font-semibold text-white">Ingestion trace</h2>
          </div>
          <Database className="h-5 w-5 text-cyan-300" />
        </div>
        <div className="mt-6 space-y-4">
          {pipelineSteps.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-2xl border border-white/5 px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-xs text-slate-400">{item.detail}</p>
              </div>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs",
                  item.active ? "bg-green-500/20 text-green-200" : "bg-slate-700 text-slate-300",
                )}
              >
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  );
}
