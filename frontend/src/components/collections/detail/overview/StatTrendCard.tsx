"use client";

import { useMemo } from "react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { TrendChart } from "@/components/ui/trend-chart";

import { growthDots, growthEvents } from "./lib/chart-series";

import type { ChartBrushSpan, ChartMarker } from "@/components/ui/trend-chart";
import type { CollectionStatsHistoryPoint } from "@/lib/types";

type StatTrendCardProps = {
  label: string;
  /** Singular noun for the tooltip's addition, e.g. "documents". */
  noun: string;
  buckets: string[];
  bucketSeconds: number;
  points: CollectionStatsHistoryPoint[];
  measure: (point: CollectionStatsHistoryPoint) => number;
  markers: ChartMarker[];
  onBrush: (span: ChartBrushSpan) => void;
  onResetBrush: () => void;
};

const format = (value: number) => value.toLocaleString();

/**
 * One measure over the collection's life, drawn as the step function it is: a
 * total only moves when something is ingested, so the line holds flat between
 * runs and jumps at each one. A dot marks every jump, sized by how much it
 * added — which is what makes a bulk import distinguishable from a trickle at
 * a glance, and a chunk jump with no matching document jump readable as a
 * chunker change once the ingest marker beside it is read.
 */
export function StatTrendCard({
  label,
  noun,
  buckets,
  bucketSeconds,
  points,
  measure,
  markers,
  onBrush,
  onResetBrush,
}: StatTrendCardProps) {
  const values = useMemo(() => points.map(measure), [measure, points]);
  const events = useMemo(
    () => growthDots(growthEvents(points, measure), buckets, "series-1", format, noun),
    [buckets, measure, noun, points],
  );

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
        step
        series={[{ id: label, label, color: "series-1", values }]}
        events={events}
        markers={markers}
        label={`${label} over time`}
        formatValue={format}
        onBrush={onBrush}
        onResetBrush={onResetBrush}
      />
    </Panel>
  );
}
