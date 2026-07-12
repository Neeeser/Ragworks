"use client";

import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type TrendSeries = {
  id: string;
  label: string;
  /** Data hue — semantic accent tokens only. */
  color: "violet" | "cyan";
  /** One value per date; null = no samples that day (renders a gap). */
  values: Array<number | null>;
};

type TrendChartProps = {
  /** ISO dates (YYYY-MM-DD), one per bucket, oldest first. */
  dates: string[];
  series: TrendSeries[];
  /** Fill the area under the first series (single-series growth charts). */
  area?: boolean;
  height?: number;
  formatValue: (value: number) => string;
  className?: string;
};

const VIEW_W = 600;
const VIEW_H = 160;
const PAD_X = 4;
const PAD_TOP = 8;
const PAD_BOTTOM = 4;

const COLOR_VAR: Record<TrendSeries["color"], string> = {
  violet: "var(--accent-violet)",
  cyan: "var(--accent-cyan)",
};

function dayLabel(date: string): string {
  // Buckets are UTC days; label them as such (never through local parsing).
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function buildPath(
  values: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    pen = true;
  });
  return path;
}

type TrendTooltipProps = {
  date: string;
  index: number;
  leftPct: number;
  series: TrendSeries[];
  formatValue: (value: number) => string;
};

function TrendTooltip({ date, index, leftPct, series, formatValue }: TrendTooltipProps) {
  const align = leftPct > 70 ? "-100%" : leftPct < 15 ? "0" : "-50%";
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-xl border border-hairline bg-canvas-raised px-3 py-2 shadow-elevation-2"
      style={{ left: `${leftPct}%`, transform: `translate(${align}, calc(-100% - 6px))` }}
    >
      <p className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
        {dayLabel(date)}
      </p>
      {series.map((entry) => {
        const value = entry.values[index];
        return (
          <p
            key={entry.id}
            className="flex items-center gap-2 whitespace-nowrap text-xs text-body"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: COLOR_VAR[entry.color] }}
              aria-hidden
            />
            {entry.label}: {value === null ? "—" : formatValue(value)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Minimal SVG time-series chart in the instrument style: hairline grid,
 * 2px series lines, and a crosshair tooltip on hover.
 */
export function TrendChart({
  dates,
  series,
  area = false,
  height = 160,
  formatValue,
  className,
}: TrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const stepX = dates.length > 1 ? (VIEW_W - PAD_X * 2) / (dates.length - 1) : 0;
  const x = useCallback((index: number) => PAD_X + index * stepX, [stepX]);
  const y = useCallback(
    (value: number) =>
      VIEW_H - PAD_BOTTOM - (value / max) * (VIEW_H - PAD_TOP - PAD_BOTTOM),
    [max],
  );

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || dates.length === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (dates.length - 1));
    setHoverIndex(Math.min(dates.length - 1, Math.max(0, index)));
  };

  const hovered = hoverIndex === null ? null : { date: dates[hoverIndex], index: hoverIndex };
  const hoverLeftPct = hovered ? (x(hovered.index) / VIEW_W) * 100 : 0;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={containerRef}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        className="relative"
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height }}
          role="img"
          aria-label={series.map((s) => s.label).join(", ")}
        >
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={VIEW_W}
              y1={VIEW_H - PAD_BOTTOM - fraction * (VIEW_H - PAD_TOP - PAD_BOTTOM)}
              y2={VIEW_H - PAD_BOTTOM - fraction * (VIEW_H - PAD_TOP - PAD_BOTTOM)}
              stroke="var(--border-hairline)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {area && series[0] && dates.length > 1 && (
            <path
              d={`${buildPath(series[0].values, x, y)}L${x(dates.length - 1).toFixed(2)},${VIEW_H - PAD_BOTTOM}L${x(0).toFixed(2)},${VIEW_H - PAD_BOTTOM}Z`}
              style={{ fill: COLOR_VAR[series[0].color] }}
              opacity={0.12}
            />
          )}
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
          {hovered && (
            <line
              x1={x(hovered.index)}
              x2={x(hovered.index)}
              y1={PAD_TOP}
              y2={VIEW_H - PAD_BOTTOM}
              stroke="var(--border-hairline)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {hovered &&
            series.map((entry) => {
              const value = entry.values[hovered.index];
              if (value === null) return null;
              return (
                <circle
                  key={entry.id}
                  cx={x(hovered.index)}
                  cy={y(value)}
                  r={3.5}
                  style={{ fill: COLOR_VAR[entry.color] }}
                  stroke="var(--canvas)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
        </svg>

        {hovered && (
          <TrendTooltip
            date={hovered.date}
            index={hovered.index}
            leftPct={hoverLeftPct}
            series={series}
            formatValue={formatValue}
          />
        )}
      </div>

      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-meta">
        <span>{dates.length ? dayLabel(dates[0]) : ""}</span>
        <span>{dates.length ? dayLabel(dates[dates.length - 1]) : ""}</span>
      </div>
    </div>
  );
}
