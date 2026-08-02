import type { TrendBand, TrendEvent, TrendSeriesColor } from "@/components/ui/trend-chart";
import type { CollectionStatsHistoryPoint, LatencyEvent } from "@/lib/types";

/** Dot radius range for growth events, in chart viewBox units. */
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 9;

export type GrowthEvent = {
  /** Index of the bucket the addition landed in. */
  index: number;
  bucket: string;
  added: number;
  total: number;
};

/**
 * The additions between consecutive cumulative totals.
 *
 * Totals are what the server sends; what a reader wants to spot is the jump,
 * so the delta is derived here rather than charted as another series. A bucket
 * that added nothing yields no event — a dot on every bucket would bury the
 * three that mattered.
 */
export function growthEvents(
  points: CollectionStatsHistoryPoint[],
  measure: (point: CollectionStatsHistoryPoint) => number,
): GrowthEvent[] {
  const events: GrowthEvent[] = [];
  points.forEach((point, index) => {
    const total = measure(point);
    const previous = index === 0 ? 0 : measure(points[index - 1]);
    const added = total - previous;
    if (added !== 0) events.push({ index, bucket: point.bucket_start, added, total });
  });
  return events;
}

/**
 * Scale a delta onto a dot radius by area, not by radius.
 *
 * A circle is read by how much ink it has, so scaling the radius linearly makes
 * a 4x ingestion look 16x bigger. The floor keeps the smallest addition visible
 * rather than shrinking it to nothing.
 */
export function radiusFor(added: number, largest: number): number {
  if (largest <= 0) return MIN_RADIUS;
  const fraction = Math.min(1, Math.abs(added) / largest);
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(fraction);
}

/**
 * Turn growth deltas into dots on the cumulative step line.
 *
 * Each dot sits at the total it produced, so the dot marks the top of its own
 * step and the size says how much of that step it was.
 */
export function growthDots(
  events: GrowthEvent[],
  buckets: string[],
  color: TrendSeriesColor,
  format: (value: number) => string,
  noun: string,
): TrendEvent[] {
  const largest = Math.max(0, ...events.map((event) => Math.abs(event.added)));
  return events.flatMap((event) => {
    const at = buckets[event.index];
    if (!at) return [];
    const sign = event.added > 0 ? "+" : "−";
    return [
      {
        id: `growth-${event.index}`,
        at,
        value: event.total,
        color,
        radius: radiusFor(event.added, largest),
        label: `${sign}${format(Math.abs(event.added))} ${noun} · ${format(event.total)} total`,
      },
    ];
  });
}

/** Samples a bucket needs before its percentiles describe a spread. */
const MIN_SPREAD_SAMPLES = 2;

/**
 * The p50–p95 spread per bucket, as a band.
 *
 * A bucket is skipped unless it holds at least two samples: one measurement has
 * no distribution, so its p50 and p95 are both just that measurement. Shading
 * those anyway is worse than useless — the band's outline runs from each lone
 * value to the next, so a single slow query in an otherwise quiet stretch
 * inflates into a wide filled wedge suggesting sustained variance nobody
 * measured. The dot is already the honest record of that query.
 *
 * Buckets with no samples are skipped for the same reason, which also breaks
 * the band rather than spanning a stretch where nothing ran.
 */
export function latencyBand(
  points: CollectionStatsHistoryPoint[],
  read: (point: CollectionStatsHistoryPoint) => {
    count?: number;
    p50_ms?: number | null;
    p95_ms?: number | null;
  },
  color: TrendSeriesColor,
  id = "spread",
): TrendBand {
  const bounded = points.map((point) => {
    const bucket = read(point);
    return (bucket.count ?? 0) >= MIN_SPREAD_SAMPLES ? bucket : null;
  });
  return {
    id,
    color,
    lower: bounded.map((bucket) => bucket?.p50_ms ?? null),
    upper: bounded.map((bucket) => bucket?.p95_ms ?? null),
  };
}

/**
 * Turn measured operations into dots.
 *
 * `isLit` decides which keys stay at full strength; the rest are dimmed rather
 * than dropped, because an unselected tool's traffic is still context for the
 * one being read — removing it would make a quiet stretch look idle when
 * another tool was busy through it. The default lights everything, which is
 * what a single-series chart wants.
 */
export function latencyDots(
  events: LatencyEvent[],
  colorOf: (key: string | null | undefined) => TrendSeriesColor,
  format: (value: number) => string,
  isLit: (key: string | null | undefined) => boolean = () => true,
): TrendEvent[] {
  return events.map((event, index) => ({
    id: `event-${index}-${event.at}`,
    at: event.at,
    value: event.duration_ms,
    color: colorOf(event.key),
    radius: 2.5,
    muted: !isLit(event.key),
    label: format(event.duration_ms),
  }));
}
