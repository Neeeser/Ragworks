"use client";

import { useMemo, useState } from "react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TrendChart } from "@/components/ui/trend-chart";
import { formatLatency } from "@/lib/format";

import type { SegmentedOption } from "@/components/ui/segmented-control";
import type { ChartBrushSpan, ChartMarker } from "@/components/ui/trend-chart";
import type { CollectionStatsHistoryPoint, LatencySummary } from "@/lib/types";

type LatencyMetric = "avg_ms" | "p50_ms" | "p95_ms" | "max_ms";

const METRICS: Array<SegmentedOption<LatencyMetric>> = [
  { id: "avg_ms", label: "avg" },
  { id: "p50_ms", label: "p50" },
  { id: "p95_ms", label: "p95" },
  { id: "max_ms", label: "max" },
];

type IngestionLatencyCardProps = {
  points: CollectionStatsHistoryPoint[];
  summary: LatencySummary;
  buckets: string[];
  bucketSeconds: number;
  markers: ChartMarker[];
  onBrush: (span: ChartBrushSpan) => void;
  onResetBrush: () => void;
};

/**
 * Ingest-run duration over the domain.
 *
 * Its own card rather than a second line on the retrieval chart: ingestion runs
 * take seconds to minutes and queries take milliseconds, so a shared y-axis
 * would flatten retrieval to the baseline. One ingest pipeline per collection,
 * so one line and no legend.
 */
export function IngestionLatencyCard({
  points,
  summary,
  buckets,
  bucketSeconds,
  markers,
  onBrush,
  onResetBrush,
}: IngestionLatencyCardProps) {
  const [metric, setMetric] = useState<LatencyMetric>("avg_ms");

  const series = useMemo(
    () => [
      {
        id: "ingestion",
        label: "Ingestion",
        color: "series-1" as const,
        values: points.map((point) => point.ingestion[metric] ?? null),
        samples: points.map((point) => point.ingestion.count || null),
      },
    ],
    [metric, points],
  );

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <InstrumentLabel className="text-body">Ingestion latency</InstrumentLabel>
          {summary.count > 0 && (
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-ui tabular-nums text-primary">
                {formatLatency(summary.avg_ms ?? null)}
              </span>
              <InstrumentLabel>avg</InstrumentLabel>
              <span className="font-mono text-ui tabular-nums text-primary">
                {formatLatency(summary.p95_ms ?? null)}
              </span>
              <InstrumentLabel>p95</InstrumentLabel>
              <span className="font-mono text-ui tabular-nums text-primary">
                {summary.count.toLocaleString()}
              </span>
              <InstrumentLabel>runs</InstrumentLabel>
            </span>
          )}
        </div>
        <SegmentedControl
          aria-label="Ingestion latency metric"
          options={METRICS}
          value={metric}
          onChange={setMetric}
        />
      </div>

      {summary.count > 0 ? (
        <TrendChart
          className="mt-2"
          buckets={buckets}
          bucketSeconds={bucketSeconds}
          height={104}
          series={series}
          markers={markers}
          label="Ingestion run duration"
          formatValue={(value) => formatLatency(value)}
          onBrush={onBrush}
          onResetBrush={onResetBrush}
        />
      ) : (
        <p className="mt-2 text-ui text-muted">No completed ingest runs in this range.</p>
      )}
    </Panel>
  );
}
