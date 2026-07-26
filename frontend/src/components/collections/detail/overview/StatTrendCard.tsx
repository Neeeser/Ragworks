"use client";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { TrendChart } from "@/components/ui/trend-chart";

import type { ChartBrushSpan, ChartMarker } from "@/components/ui/trend-chart";

type StatTrendCardProps = {
  label: string;
  buckets: string[];
  bucketSeconds: number;
  values: number[];
  markers: ChartMarker[];
  onBrush: (span: ChartBrushSpan) => void;
  onResetBrush: () => void;
};

/**
 * One measure over the collection's life. A single series, so the title names
 * it and there is no legend box. Ingest-pipeline markers sit on the axis: a
 * chunk-count jump with no matching document jump is a chunker change, and the
 * marker is the explanation.
 */
export function StatTrendCard({
  label,
  buckets,
  bucketSeconds,
  values,
  markers,
  onBrush,
  onResetBrush,
}: StatTrendCardProps) {
  return (
    <Panel className="p-3">
      {/* No total here: the KPI strip above carries the current value, and the
          chart's last point is that same number. Printing it twice on one screen
          is the redundancy the composition rule exists to prevent. */}
      <InstrumentLabel className="mb-2 block text-body">{label}</InstrumentLabel>
      <TrendChart
        buckets={buckets}
        bucketSeconds={bucketSeconds}
        height={104}
        area
        series={[{ id: label, label, color: "series-1", values }]}
        markers={markers}
        label={`${label} over time`}
        formatValue={(value) => value.toLocaleString()}
        onBrush={onBrush}
        onResetBrush={onResetBrush}
      />
    </Panel>
  );
}
