"use client";

import { TrendChart } from "@/components/collections/detail/overview/TrendChart";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";

type StatTrendCardProps = {
  label: string;
  buckets: string[];
  granularity: "hour" | "day";
  values: number[];
};

/**
 * One measure over time. A single series, so the title names it and there is no
 * legend box.
 */
export function StatTrendCard({ label, buckets, granularity, values }: StatTrendCardProps) {
  return (
    <Panel className="p-3">
      {/* No total here: the KPI strip above carries the current value, and the
          chart's last point is that same number. Printing it twice on one screen
          is the redundancy the composition rule exists to prevent. */}
      <InstrumentLabel className="mb-2 block text-body">{label}</InstrumentLabel>
      <TrendChart
        buckets={buckets}
        granularity={granularity}
        height={104}
        area
        series={[{ id: label, label, color: "series-1", values }]}
        formatValue={(value) => value.toLocaleString()}
      />
    </Panel>
  );
}
