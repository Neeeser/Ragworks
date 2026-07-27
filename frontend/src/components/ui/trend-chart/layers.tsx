"use client";

import { COLOR_VAR, PAD_BOTTOM, PAD_TOP, VIEW_H, VIEW_W, buildPath, isIsolated } from "./scales";

import type { TrendSeries } from "./types";
import type { BucketSelection } from "./use-chart-brush";

type Scale = {
  x: (index: number) => number;
  y: (value: number) => number;
};

const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

/** Hairline reference lines at the quarter marks. */
export function GridLines() {
  return (
    <>
      {[0.25, 0.5, 0.75].map((fraction) => {
        const y = VIEW_H - PAD_BOTTOM - fraction * PLOT_H;
        return (
          <line
            key={fraction}
            x1={0}
            x2={VIEW_W}
            y1={y}
            y2={y}
            stroke="var(--border-hairline)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </>
  );
}

/** The band under an in-progress or committed brush selection. */
export function SelectionBand({ selection, x }: { selection: BucketSelection } & Pick<Scale, "x">) {
  return (
    <rect
      x={x(selection.from)}
      width={Math.max(1, x(selection.to) - x(selection.from))}
      y={PAD_TOP}
      height={PLOT_H}
      fill="var(--accent-violet)"
      opacity={0.14}
    />
  );
}

/** Filled area under the first series, for single-series growth charts. */
export function AreaFill({
  series,
  bucketCount,
  x,
  y,
}: { series: TrendSeries; bucketCount: number } & Scale) {
  const baseline = VIEW_H - PAD_BOTTOM;
  return (
    <path
      d={`${buildPath(series.values, x, y)}L${x(bucketCount - 1).toFixed(2)},${baseline}L${x(0).toFixed(2)},${baseline}Z`}
      style={{ fill: COLOR_VAR[series.color] }}
      opacity={0.12}
    />
  );
}

/**
 * Series lines, plus a dot for any sample with no drawn neighbour — a lone
 * measurement should read as one measurement, not as a break in continuity.
 */
export function SeriesLayer({ series, x, y }: { series: TrendSeries[] } & Scale) {
  return (
    <>
      {series.map((entry) => (
        <path
          key={entry.id}
          d={buildPath(entry.values, x, y)}
          fill="none"
          style={{ stroke: COLOR_VAR[entry.color] }}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {series.map((entry) =>
        entry.values.map((value, index) =>
          value !== null && isIsolated(entry.values, index) ? (
            <circle
              key={`${entry.id}-${index}`}
              cx={x(index)}
              cy={y(value)}
              r={3}
              style={{ fill: COLOR_VAR[entry.color] }}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        ),
      )}
    </>
  );
}

/** Crosshair rule and the per-series markers on the hovered bucket. */
export function CursorLayer({
  index,
  series,
  x,
  y,
}: { index: number; series: TrendSeries[] } & Scale) {
  return (
    <>
      <line
        x1={x(index)}
        x2={x(index)}
        y1={PAD_TOP}
        y2={VIEW_H - PAD_BOTTOM}
        stroke="var(--border-hairline)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {series.map((entry) => {
        const value = entry.values[index];
        return value === null ? null : (
          <circle
            key={entry.id}
            cx={x(index)}
            cy={y(value)}
            r={3.5}
            style={{ fill: COLOR_VAR[entry.color] }}
            stroke="var(--canvas)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </>
  );
}
