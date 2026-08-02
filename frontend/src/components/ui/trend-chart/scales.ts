import { parseApiDate, resolvedTimeZone } from "@/lib/datetime";

/** Chart geometry. The viewBox is fixed; the element scales to its container. */
export const VIEW_W = 600;
export const VIEW_H = 160;
export const PAD_X = 4;
export const PAD_TOP = 8;
export const PAD_BOTTOM = 4;

export const HOUR_SECONDS = 3600;
export const DAY_SECONDS = 86400;

export const COLOR_VAR: Record<TrendSeriesColor, string> = {
  "series-1": "var(--series-1)",
  "series-2": "var(--series-2)",
  "series-3": "var(--series-3)",
  "series-4": "var(--series-4)",
  "series-5": "var(--series-5)",
  "series-6": "var(--series-6)",
  neutral: "var(--port-default)",
};

/**
 * Chart series slots. These are NOT the UI accent tokens: --accent-cyan measures
 * L 0.797 on the dark canvas, outside the categorical lightness band, so beside
 * violet it outshines its peer and two equal series stop reading as equal.
 * `neutral` is for a series that is an absence rather than an entity.
 */
export type TrendSeriesColor =
  | "series-1"
  | "series-2"
  | "series-3"
  | "series-4"
  | "series-5"
  | "series-6"
  | "neutral";

/** The series slots, in the fixed order the design language assigns them. */
export const SERIES_COLORS: TrendSeriesColor[] = [
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
];

/**
 * Label a bucket at a width that suits its size.
 *
 * Buckets are `date_bin` offsets from the domain start rather than clock-aligned
 * truncations, so a day-wide bucket can begin at 14:37 — these render in the
 * viewer's own zone, where that offset at least reads as a real local time.
 */
export function bucketLabel(iso: string, bucketSeconds: number): string {
  const date = parseApiDate(iso) ?? new Date(iso);
  const options: Intl.DateTimeFormatOptions =
    bucketSeconds < HOUR_SECONDS
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : bucketSeconds < DAY_SECONDS
        ? { month: "short", day: "numeric", hour: "numeric" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: resolvedTimeZone() }).format(
    date,
  );
}

/** Label a UTC-truncated day bucket as that UTC day, never through local parsing. */
export function utcDayLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseApiDate(iso) ?? new Date(iso));
}

/** Full timestamp for a tooltip, where the bucket's real offset matters. */
export function bucketTimestamp(iso: string, bucketSeconds: number): string {
  const date = parseApiDate(iso) ?? new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(bucketSeconds >= DAY_SECONDS ? { year: undefined } : {}),
    timeZone: resolvedTimeZone(),
  }).format(date);
}

/**
 * Build an SVG path, lifting the pen across nulls so a gap stays a gap rather
 * than a straight line implying data nobody recorded.
 */
export function buildPath(
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

/**
 * Build a step path: hold each value until the next one, then jump.
 *
 * A cumulative total is a step function — it changes only when something is
 * ingested. Interpolating between samples draws a collection growing steadily
 * through nights when nothing happened, which is the shape a reader is trying
 * to distinguish a real ingestion from.
 */
export function buildStepPath(
  values: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let held: number | null = null;
  let last = 0;
  values.forEach((value, index) => {
    if (value === null) return;
    if (held === null) {
      path += `M${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    } else {
      path += `L${x(index).toFixed(2)},${y(held).toFixed(2)}L${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    }
    held = value;
    last = index;
  });
  // A total holds until something changes it, so the line runs to the domain
  // edge. Stopping at the final sample would read as the collection ending.
  if (held !== null && last < values.length - 1) {
    path += `L${x(values.length - 1).toFixed(2)},${y(held).toFixed(2)}`;
  }
  return path;
}

/**
 * Build a closed band between two bounds: out along `upper`, back along
 * `lower`. Buckets where either bound is missing break the band into separate
 * shapes rather than spanning a gap nobody measured.
 */
export function buildBandPath(
  lower: Array<number | null>,
  upper: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    const top = run.map((i) => `${x(i).toFixed(2)},${y(upper[i] as number).toFixed(2)}`);
    const bottom = [...run]
      .reverse()
      .map((i) => `${x(i).toFixed(2)},${y(lower[i] as number).toFixed(2)}`);
    path += `M${top.join("L")}L${bottom.join("L")}Z`;
    run = [];
  };
  upper.forEach((value, index) => {
    if (value === null || lower[index] === null) flush();
    else run.push(index);
  });
  flush();
  return path;
}

/**
 * Where a timestamp falls on the bucket axis, as a fractional index.
 *
 * Events happen at moments, not in buckets, so they position between the
 * bucket ticks the aggregate series are drawn on. Returns null outside the
 * domain, so an event just past the end is dropped rather than drawn off-plot.
 */
export function fractionalIndex(
  iso: string,
  firstBucket: string,
  bucketSeconds: number,
  bucketCount: number,
): number | null {
  const at = parseApiDate(iso) ?? new Date(iso);
  const origin = parseApiDate(firstBucket) ?? new Date(firstBucket);
  if (Number.isNaN(at.getTime()) || Number.isNaN(origin.getTime())) return null;
  const index = (at.getTime() - origin.getTime()) / (bucketSeconds * 1000);
  if (index < 0 || index > bucketCount - 1) return null;
  return index;
}

/** True when a sample has no drawn neighbour, so it needs a dot to be visible. */
export function isIsolated(values: Array<number | null>, index: number): boolean {
  if (values[index] === null) return false;
  const prev = index > 0 ? values[index - 1] : null;
  const next = index < values.length - 1 ? values[index + 1] : null;
  return prev === null && next === null;
}
