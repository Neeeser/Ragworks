"use client";

import { AreaFill, CursorLayer, GridLines, SelectionBand, SeriesLayer } from "./layers";
import { VIEW_H, VIEW_W } from "./scales";

import type { TrendSeries } from "./types";
import type { BucketSelection } from "./use-chart-brush";

type ChartPlotProps = {
  buckets: string[];
  series: TrendSeries[];
  selection: BucketSelection | null;
  cursor: number | null;
  area: boolean;
  height: number;
  name: string;
  x: (index: number) => number;
  y: (value: number) => number;
};

/** The SVG itself: grid, selection band, series, and the cursor overlay. */
export function ChartPlot({
  buckets,
  series,
  selection,
  cursor,
  area,
  height,
  name,
  x,
  y,
}: ChartPlotProps) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={name}
    >
      <GridLines />
      {selection && <SelectionBand selection={selection} x={x} />}
      {area && series[0] && buckets.length > 1 && (
        <AreaFill series={series[0]} bucketCount={buckets.length} x={x} y={y} />
      )}
      <SeriesLayer series={series} x={x} y={y} />
      {cursor !== null && <CursorLayer index={cursor} series={series} x={x} y={y} />}
    </svg>
  );
}
