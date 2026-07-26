"use client";

import { useMemo, useState } from "react";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { parseApiDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { COLOR_VAR, bucketTimestamp } from "./scales";

import type { TrendSeriesColor } from "./scales";

/** A change worth explaining a movement in the chart above it. */
export type ChartMarker = {
  id: string;
  at: string;
  label: string;
  color?: TrendSeriesColor;
};

type MarkerGroup = {
  index: number;
  markers: ChartMarker[];
};

/**
 * Group markers by the bucket they fall in.
 *
 * Collapsing is what keeps the axis readable: a pipeline saved twenty times in
 * one afternoon would otherwise draw twenty ticks in the same pixel. There can
 * never be more ticks than buckets, at any zoom level.
 */
export function groupMarkers(
  markers: ChartMarker[],
  buckets: string[],
  bucketSeconds: number,
): MarkerGroup[] {
  if (buckets.length === 0 || bucketSeconds <= 0) return [];
  const origin = (parseApiDate(buckets[0]) ?? new Date(buckets[0])).getTime();
  const byIndex = new Map<number, ChartMarker[]>();
  for (const marker of markers) {
    const at = parseApiDate(marker.at) ?? new Date(marker.at);
    const offset = Math.floor((at.getTime() - origin) / (bucketSeconds * 1000));
    if (offset < 0 || offset > buckets.length - 1) continue;
    byIndex.set(offset, [...(byIndex.get(offset) ?? []), marker]);
  }
  return [...byIndex.entries()]
    .map(([index, grouped]) => ({ index, markers: grouped }))
    .sort((a, b) => a.index - b.index);
}

type MarkerRailProps = {
  markers: ChartMarker[];
  buckets: string[];
  bucketSeconds: number;
  /** Fractional x position (0–1) of a bucket index, matching the chart's scale. */
  positionOf: (index: number) => number;
};

/**
 * The tick rail beneath a chart. Each tick is a bucket that saw pipeline
 * changes; hovering one lists them.
 */
export function MarkerRail({ markers, buckets, bucketSeconds, positionOf }: MarkerRailProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const groups = useMemo(
    () => groupMarkers(markers, buckets, bucketSeconds),
    [markers, buckets, bucketSeconds],
  );

  if (groups.length === 0) return null;

  return (
    <div className="relative h-4">
      {groups.map((group) => {
        const leftPct = positionOf(group.index) * 100;
        const color = COLOR_VAR[group.markers[0].color ?? "neutral"];
        const open = openIndex === group.index;
        return (
          <div
            key={group.index}
            className="absolute top-0"
            style={{ left: `${leftPct}%`, transform: "translateX(-50%)" }}
            onMouseEnter={() => setOpenIndex(group.index)}
            onMouseLeave={() => setOpenIndex(null)}
          >
            <span
              className="block h-2.5 w-[3px] rounded-[1px]"
              style={{ background: color }}
              aria-hidden
            />
            {group.markers.length > 1 && (
              <span className="mt-0.5 block text-center font-mono text-instrument text-meta">
                {group.markers.length}
              </span>
            )}
            {open && (
              <div
                className={cn(
                  popoverSurfaceClass,
                  "pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 px-2 py-1",
                )}
              >
                {group.markers.map((marker) => (
                  <p key={marker.id} className="whitespace-nowrap text-ui text-body">
                    {marker.label}
                    <span className="ml-2 font-mono text-instrument text-meta">
                      {bucketTimestamp(marker.at, bucketSeconds)}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
