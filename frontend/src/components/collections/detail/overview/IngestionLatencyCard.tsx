"use client";

import { useMemo } from "react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { TrendChart } from "@/components/ui/trend-chart";
import { formatLatency } from "@/lib/format";

import { latencyBand, latencyDots } from "./lib/chart-series";

import type { ChartBrushSpan, ChartMarker } from "@/components/ui/trend-chart";
import type { CollectionStatsHistoryPoint, LatencyEvent, LatencySummary } from "@/lib/types";

type IngestionLatencyCardProps = {
  points: CollectionStatsHistoryPoint[];
  summary: LatencySummary;
  events: LatencyEvent[];
  sampled: boolean;
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
 *
 * Every run is a dot at the moment it ran, with the median line and p50–p95
 * band over them. There is no metric selector: the four states it switched
 * between are all on screen at once, and picking one at a time was what made a
 * change in the spread — the thing a pipeline edit actually moves — invisible
 * unless you happened to be on the right toggle.
 */
export function IngestionLatencyCard({
  points,
  summary,
  events,
  sampled,
  buckets,
  bucketSeconds,
  markers,
  onBrush,
  onResetBrush,
}: IngestionLatencyCardProps) {
  const series = useMemo(
    () => [
      {
        id: "ingestion",
        label: "Median",
        color: "series-1" as const,
        values: points.map((point) => point.ingestion.p50_ms ?? null),
        samples: points.map((point) => point.ingestion.count || null),
      },
    ],
    [points],
  );
  const bands = useMemo(
    () => [latencyBand(points, (point) => point.ingestion, "series-1")],
    [points],
  );
  const dots = useMemo(() => latencyDots(events, () => "series-1", formatLatency), [events]);

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <InstrumentLabel className="text-body">Ingestion latency</InstrumentLabel>
        {summary.count > 0 && (
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-ui tabular-nums text-primary">
              {formatLatency(summary.p50_ms ?? null)}
            </span>
            <InstrumentLabel>median</InstrumentLabel>
            <span className="font-mono text-ui tabular-nums text-primary">
              {formatLatency(summary.p95_ms ?? null)}
            </span>
            <InstrumentLabel>p95</InstrumentLabel>
            <span className="font-mono text-ui tabular-nums text-primary">
              {formatLatency(summary.max_ms ?? null)}
            </span>
            <InstrumentLabel>max</InstrumentLabel>
            <span className="font-mono text-ui tabular-nums text-primary">
              {summary.count.toLocaleString()}
            </span>
            <InstrumentLabel>runs</InstrumentLabel>
          </span>
        )}
      </div>

      {summary.count > 0 ? (
        <>
          <TrendChart
            className="mt-2"
            buckets={buckets}
            bucketSeconds={bucketSeconds}
            height={128}
            series={series}
            bands={bands}
            events={dots}
            markers={markers}
            label="Ingestion run duration"
            formatValue={(value) => formatLatency(value)}
            onBrush={onBrush}
            onResetBrush={onResetBrush}
          />
          <ChartLegend sampled={sampled} unit="runs" />
        </>
      ) : (
        <p className="mt-2 text-ui text-muted">No completed ingest runs in this range.</p>
      )}
    </Panel>
  );
}

/**
 * What the three marks on a latency chart mean.
 *
 * The band and dots are unlabelled shapes otherwise, and a reader who reads the
 * band as a second series draws the opposite conclusion from a widening one.
 */
export function ChartLegend({ sampled, unit }: { sampled: boolean; unit: string }) {
  return (
    <p className="mt-1 text-instrument text-meta">
      Each dot is one {unit.replace(/s$/, "")}; the line is the median and the band spans p50–p95.
      {sampled &&
        ` Dots are a sample of a larger set of ${unit} — the line and band cover them all.`}
    </p>
  );
}
