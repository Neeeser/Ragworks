"use client";

import { useCallback } from "react";

import { cn } from "@/lib/utils";

import { MarkerRail } from "./markers";
import { ChartPlot } from "./plot";
import { PAD_BOTTOM, PAD_TOP, PAD_X, VIEW_H, VIEW_W, bucketLabel, bucketTimestamp } from "./scales";
import { TrendTooltip } from "./tooltip";
import { useChartBrush } from "./use-chart-brush";

import type { TrendChartProps } from "./types";

const KEYBOARD_HINT =
  "Arrow keys move the cursor, shift+arrows select a range, enter zooms, escape resets.";

/**
 * Minimal SVG time-series chart in the instrument style: hairline grid, 2px
 * series lines, a crosshair tooltip, an optional marker rail, and optional
 * drag/keyboard range selection.
 */
export function TrendChart({
  buckets,
  bucketSeconds,
  series,
  area = false,
  height = 160,
  formatValue,
  formatBucket,
  markers,
  onBrush,
  onResetBrush,
  label,
  className,
}: TrendChartProps) {
  const { containerRef, cursor, selection, handlers } = useChartBrush({
    buckets,
    bucketSeconds,
    onBrush,
    onResetBrush,
  });

  const max = Math.max(
    1,
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
  );
  const stepX = buckets.length > 1 ? (VIEW_W - PAD_X * 2) / (buckets.length - 1) : 0;
  const x = useCallback((index: number) => PAD_X + index * stepX, [stepX]);
  const y = useCallback(
    (value: number) => VIEW_H - PAD_BOTTOM - (value / max) * (VIEW_H - PAD_TOP - PAD_BOTTOM),
    [max],
  );
  const positionOf = useCallback((index: number) => x(index) / VIEW_W, [x]);
  const axisLabel = useCallback(
    (iso: string) => (formatBucket ? formatBucket(iso) : bucketLabel(iso, bucketSeconds)),
    [bucketSeconds, formatBucket],
  );

  const name = label ?? series.map((s) => s.label).join(", ");
  const interactive = Boolean(onBrush);
  const hoveredBucket = cursor === null ? null : buckets[cursor];

  return (
    <div className={cn("relative", className)}>
      <div
        ref={containerRef}
        {...handlers}
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? "group" : undefined}
        aria-label={interactive ? `${name}. ${KEYBOARD_HINT}` : undefined}
        className={cn(
          "relative",
          interactive &&
            "cursor-crosshair rounded-control focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-canvas focus-visible:outline-none",
        )}
      >
        <ChartPlot
          buckets={buckets}
          series={series}
          selection={selection}
          cursor={cursor}
          area={area}
          height={height}
          name={name}
          x={x}
          y={y}
        />

        {cursor !== null && hoveredBucket && (
          <TrendTooltip
            bucket={hoveredBucket}
            bucketSeconds={bucketSeconds}
            index={cursor}
            leftPct={positionOf(cursor) * 100}
            series={series}
            formatValue={formatValue}
          />
        )}
      </div>

      {markers && markers.length > 0 && (
        <MarkerRail
          markers={markers}
          buckets={buckets}
          bucketSeconds={bucketSeconds}
          positionOf={positionOf}
        />
      )}

      <div className="mt-1 flex justify-between font-mono text-instrument text-meta">
        <span>{buckets.length ? axisLabel(buckets[0]) : ""}</span>
        <span>{buckets.length ? axisLabel(buckets[buckets.length - 1]) : ""}</span>
      </div>

      {interactive && (
        <span className="sr-only" role="status" aria-live="polite">
          {cursor !== null && hoveredBucket
            ? readout(hoveredBucket, bucketSeconds, cursor, series, formatValue)
            : ""}
        </span>
      )}
    </div>
  );
}

/** Spoken form of the cursor's bucket — the keyboard path's view of the data. */
function readout(
  bucket: string,
  bucketSeconds: number,
  index: number,
  series: TrendChartProps["series"],
  formatValue: (value: number) => string,
): string {
  const values = series
    .map((entry) => {
      const value = entry.values[index];
      return `${entry.label} ${value === null ? "no data" : formatValue(value)}`;
    })
    .join(", ");
  return `${bucketTimestamp(bucket, bucketSeconds)}: ${values}`;
}
