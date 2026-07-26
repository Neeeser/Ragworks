"use client";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import { COLOR_VAR, bucketTimestamp } from "./scales";

import type { TrendSeries } from "./types";

type TrendTooltipProps = {
  bucket: string;
  bucketSeconds: number;
  index: number;
  leftPct: number;
  series: TrendSeries[];
  formatValue: (value: number) => string;
};

/**
 * Crosshair readout. Sample counts ride along whenever a series carries them —
 * a p95 drawn from one query is noise, and the count is what lets a reader
 * discount it without leaving the chart.
 */
export function TrendTooltip({
  bucket,
  bucketSeconds,
  index,
  leftPct,
  series,
  formatValue,
}: TrendTooltipProps) {
  const align = leftPct > 70 ? "-100%" : leftPct < 15 ? "0" : "-50%";
  const present = series.filter((entry) => entry.values[index] !== null);
  return (
    <div
      className={cn(popoverSurfaceClass, "pointer-events-none absolute top-0 z-10 px-2 py-1")}
      style={{ left: `${leftPct}%`, transform: `translate(${align}, calc(-100% - 6px))` }}
    >
      <p className="whitespace-nowrap font-mono text-instrument text-muted">
        {bucketTimestamp(bucket, bucketSeconds)}
      </p>
      {(present.length > 0 ? present : series).map((entry) => {
        const value = entry.values[index];
        const samples = entry.samples?.[index];
        return (
          <p key={entry.id} className="flex items-center gap-2 whitespace-nowrap text-ui text-body">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: COLOR_VAR[entry.color] }}
              aria-hidden
            />
            {entry.label}: {value === null ? "—" : formatValue(value)}
            {samples ? (
              <span className="font-mono text-instrument text-meta">
                n={samples.toLocaleString()}
              </span>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}
