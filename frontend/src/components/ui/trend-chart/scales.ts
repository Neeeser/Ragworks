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

/** True when a sample has no drawn neighbour, so it needs a dot to be visible. */
export function isIsolated(values: Array<number | null>, index: number): boolean {
  if (values[index] === null) return false;
  const prev = index > 0 ? values[index - 1] : null;
  const next = index < values.length - 1 ? values[index + 1] : null;
  return prev === null && next === null;
}
