/**
 * The dashboard's time range and the bucket size it implies.
 *
 * The API buckets with `date_trunc`, so bucket starts are clock-aligned UTC
 * boundaries — the axis is built the same way here rather than from the range
 * start, or every tick sits at an offset no point was ever stamped with.
 */

import type { UsageBucket } from "@/lib/types";

export const RANGE_PRESETS = ["7d", "30d", "90d"] as const;
export type UsageRangePreset = (typeof RANGE_PRESETS)[number];

export const PRESET_DAYS: Record<UsageRangePreset, number> = { "7d": 7, "30d": 30, "90d": 90 };

export interface UsageRangeState {
  preset: UsageRangePreset | "custom";
  /** `YYYY-MM-DD`, read as local days so a user's "Aug 1" is their own. */
  customStart: string;
  customEnd: string;
}

export interface ResolvedRange {
  start: string;
  end: string;
  bucket: UsageBucket;
}

export const DEFAULT_RANGE: UsageRangeState = { preset: "30d", customStart: "", customEnd: "" };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Below this a day bucket leaves too few ticks to read, so the axis is hourly. */
const HOURLY_UNDER_DAYS = 3;

/** True when the custom range is complete and runs forwards. */
export function isCustomRangeValid(state: UsageRangeState): boolean {
  if (state.preset !== "custom") return true;
  if (!state.customStart || !state.customEnd) return false;
  return state.customStart <= state.customEnd;
}

/**
 * The range to request, plus its bucket size.
 *
 * A custom range covers whole local days — its end is the end of the chosen
 * day, so picking one day is a day of data rather than an empty instant.
 */
export function resolveRange(state: UsageRangeState, now: Date = new Date()): ResolvedRange {
  if (state.preset === "custom" && isCustomRangeValid(state)) {
    const start = new Date(`${state.customStart}T00:00:00`);
    const end = new Date(`${state.customEnd}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return withBucket(start, end);
  }
  const preset = state.preset === "custom" ? "30d" : state.preset;
  return withBucket(new Date(now.getTime() - PRESET_DAYS[preset] * DAY_MS), now);
}

function withBucket(start: Date, end: Date): ResolvedRange {
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    bucket: days < HOURLY_UNDER_DAYS ? "hour" : "day",
  };
}

/** Seconds in one bucket — the width `TrendChart` labels its axis by. */
export function bucketSeconds(bucket: UsageBucket): number {
  return bucket === "hour" ? 3600 : 86400;
}

/**
 * Every bucket start in the range, UTC-truncated like the API's own.
 *
 * The axis is built from the range rather than from the returned points so a
 * quiet stretch renders as a gap in the series instead of collapsing the
 * timeline onto the days that happened to have activity.
 */
export function buildBuckets(range: ResolvedRange): string[] {
  const step = range.bucket === "hour" ? HOUR_MS : DAY_MS;
  const first = Math.floor(new Date(range.start).getTime() / step) * step;
  const last = Math.floor(new Date(range.end).getTime() / step) * step;
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
  const buckets: string[] = [];
  for (let at = first; at <= last; at += step) {
    buckets.push(new Date(at).toISOString());
  }
  return buckets;
}
