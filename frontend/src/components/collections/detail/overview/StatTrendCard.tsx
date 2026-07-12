"use client";

import { TrendChart } from "@/components/collections/detail/overview/TrendChart";
import { GlassCard } from "@/components/ui/panel";

type StatTrendCardProps = {
  label: string;
  total: number;
  dates: string[];
  values: number[];
};

/** Hero count with its growth-over-time area chart. */
export function StatTrendCard({ label, total, dates, values }: StatTrendCardProps) {
  return (
    <GlassCard className="rounded-3xl p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-primary">
        {total.toLocaleString()}
      </p>
      <TrendChart
        className="mt-4"
        dates={dates}
        height={96}
        area
        series={[{ id: label, label, color: "violet", values }]}
        formatValue={(value) => value.toLocaleString()}
      />
    </GlassCard>
  );
}
