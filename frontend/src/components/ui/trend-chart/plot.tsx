"use client";

import {
  AreaFill,
  BandLayer,
  CursorLayer,
  EventLayer,
  GridLines,
  SelectionBand,
  SeriesLayer,
} from "./layers";
import { VIEW_H, VIEW_W } from "./scales";

import type { TrendBand, TrendEvent, TrendSeries } from "./types";
import type { BucketSelection } from "./use-chart-brush";
import type { PlotScale } from "./use-plot-scale";

type ChartPlotProps = {
  buckets: string[];
  series: TrendSeries[];
  bands: TrendBand[];
  events: Array<TrendEvent & { index: number }>;
  scale: PlotScale;
  selection: BucketSelection | null;
  cursor: number | null;
  area: boolean;
  step: boolean;
  height: number;
  name: string;
  x: (index: number) => number;
  y: (value: number) => number;
};

/**
 * The SVG itself, back to front: grid, selection, band, area, event dots, then
 * the series line and cursor. The line stays above the dots it summarizes —
 * it is the reading, and the cloud is the evidence behind it.
 */
export function ChartPlot({
  buckets,
  series,
  bands,
  events,
  scale,
  selection,
  cursor,
  area,
  step,
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
      {bands.length > 0 && <BandLayer bands={bands} x={x} y={y} />}
      {area && series[0] && buckets.length > 1 && (
        <AreaFill series={series[0]} bucketCount={buckets.length} step={step} x={x} y={y} />
      )}
      {events.length > 0 && <EventLayer events={events} scale={scale} x={x} y={y} />}
      <SeriesLayer series={series} step={step} scale={scale} x={x} y={y} />
      {cursor !== null && <CursorLayer index={cursor} series={series} scale={scale} x={x} y={y} />}
    </svg>
  );
}
