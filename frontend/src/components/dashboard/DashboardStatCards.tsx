import { Activity, Layers, Upload } from "lucide-react";

import { GlassCard } from "@/components/ui/panel";

import type { DashboardStats } from "@/app/(console)/dashboard/use-dashboard-data";

type DashboardStatCardsProps = {
  collectionCount: number;
  sessionCount: number;
  stats: DashboardStats;
};

export function DashboardStatCards({
  collectionCount,
  sessionCount,
  stats,
}: DashboardStatCardsProps) {
  const cards = [
    {
      label: "Collections live",
      value: collectionCount,
      icon: Layers,
      subtext: `${stats.totalChunks} chunks indexed`,
    },
    {
      label: "Documents ingested",
      value: stats.docCount,
      icon: Upload,
      subtext: `${stats.totalTokens.toLocaleString()} tokens parsed`,
    },
    {
      label: "Chat sessions",
      value: sessionCount,
      icon: Activity,
      subtext: `${stats.contextUtilization}% context utilization`,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <GlassCard key={card.label} className="rounded-3xl p-6">
          <div className="flex items-center justify-between">
            <card.icon className="h-5 w-5 text-violet-300" />
            <span className="text-sm text-slate-400">{card.label}</span>
          </div>
          <p className="mt-4 text-4xl font-semibold">{card.value}</p>
          <p className="text-sm text-slate-400">{card.subtext}</p>
        </GlassCard>
      ))}
    </section>
  );
}
