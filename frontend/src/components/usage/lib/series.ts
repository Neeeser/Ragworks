/**
 * Turning a usage summary into chart input.
 *
 * Everything here obeys one rule: quantities in different units are never
 * added. A measure is either dollars — the only figure that crosses units — or
 * one named unit's count, and a series carries whichever the caller picked.
 */

import { SERIES_COLORS } from "@/components/ui/trend-chart";
import { parseApiDate } from "@/lib/datetime";
import { formatCount, formatUsd } from "@/lib/format";

import { KIND_LABELS, KIND_ORDER, UNIT_LABELS } from "./labels";

import type { TrendSeries } from "@/components/ui/trend-chart";
import type { UsageGroupRow, UsageSummaryRead, UsageUnit } from "@/lib/types";

/** What the chart and the breakdown bars are reading. */
export type UsageMeasure = { kind: "cost" } | { kind: "quantity"; unit: UsageUnit };

export const COST_MEASURE: UsageMeasure = { kind: "cost" };

/** Stable string form, so a measure can key a control and a query. */
export function measureId(measure: UsageMeasure): string {
  return measure.kind === "cost" ? "cost" : measure.unit;
}

export function measureLabel(measure: UsageMeasure): string {
  return measure.kind === "cost" ? "Cost" : UNIT_LABELS[measure.unit];
}

export function formatMeasure(measure: UsageMeasure, value: number): string {
  return measure.kind === "cost" ? formatUsd(value) : formatCount(value);
}

/**
 * The measures this range can honestly offer, most informative first.
 *
 * Cost leads whenever the range priced anything — and whether it did is read
 * from the group rows and series points, never from `totals`. A unit total is
 * exactly the figure the API suppresses when any counted event is unpriced, so
 * on the ordinary install that mixes a priced provider with an unpriced one it
 * is null across the board and a spend dashboard would offer no way to see
 * spend, while the table beside it prints real per-model costs.
 *
 * Units then follow by descending quantity. The comparison is a ranking of
 * where the range's activity sits, not an equivalence between units — it puts
 * the millions of tokens ahead of the four search units, so the page opens on
 * the view that shows something.
 */
export function availableMeasures(summary: UsageSummaryRead | null): UsageMeasure[] {
  if (!summary) return [];
  const units = [...summary.totals]
    .sort((left, right) => right.quantity - left.quantity || right.event_count - left.event_count)
    .map((total): UsageMeasure => ({ kind: "quantity", unit: total.unit }));
  const priced =
    summary.groups.some((group) => group.cost_usd !== null) ||
    summary.series.some((point) => point.cost_usd !== null);
  return priced ? [COST_MEASURE, ...units] : units;
}

/** The measure to read, falling back when the selected one left the range. */
export function resolveMeasure(
  selected: string | null,
  available: UsageMeasure[],
): UsageMeasure | null {
  const match = available.find((measure) => measureId(measure) === selected);
  return match ?? available[0] ?? null;
}

/**
 * One series per kind that appears in the range, aligned to `buckets`.
 *
 * A bucket with no points for a kind is `null` — a gap, not a zero, because
 * nothing was recorded there. A cost bucket whose points include an unpriced
 * event is also `null`: a partial dollar figure drawn as the bucket's spend
 * reads as the whole of it.
 */
export function buildKindSeries(
  summary: UsageSummaryRead,
  buckets: string[],
  measure: UsageMeasure,
): TrendSeries[] {
  const index = new Map(buckets.map((bucket, at) => [bucketKey(bucket), at]));
  const totals = new Map<string, Array<number | null>>();
  const unpriced = new Set<string>();

  summary.series.forEach((point) => {
    if (measure.kind === "quantity" && point.unit !== measure.unit) return;
    const at = index.get(bucketKey(point.bucket_start));
    if (at === undefined) return;
    const values = totals.get(point.kind) ?? buckets.map(() => null);
    totals.set(point.kind, values);
    if (measure.kind === "cost" && point.cost_usd === null) {
      unpriced.add(`${point.kind}:${at}`);
      return;
    }
    const value = measure.kind === "cost" ? (point.cost_usd ?? 0) : point.quantity;
    values[at] = (values[at] ?? 0) + value;
  });

  unpriced.forEach((entry) => {
    const separator = entry.lastIndexOf(":");
    const values = totals.get(entry.slice(0, separator));
    if (values) values[Number(entry.slice(separator + 1))] = null;
  });

  return KIND_ORDER.filter((kind) => totals.has(kind)).map((kind) => ({
    id: kind,
    label: KIND_LABELS[kind],
    color: SERIES_COLORS[KIND_ORDER.indexOf(kind) % SERIES_COLORS.length],
    values: totals.get(kind) ?? [],
  }));
}

/**
 * Total spend per bucket, drawn alongside the per-kind lines.
 *
 * Dollars are the one figure that crosses units, so a total is meaningful
 * under the cost measure and nowhere else — "spend over time" read off a set
 * of per-kind lines otherwise leaves the reader adding them up by eye. A
 * bucket holding any unpriced event is `null` for the same reason a kind's is.
 */
export function buildTotalCostSeries(
  summary: UsageSummaryRead,
  buckets: string[],
): TrendSeries | null {
  const index = new Map(buckets.map((bucket, at) => [bucketKey(bucket), at]));
  const values: Array<number | null> = buckets.map(() => null);
  const unpriced = new Set<number>();
  let counted = false;

  summary.series.forEach((point) => {
    const at = index.get(bucketKey(point.bucket_start));
    if (at === undefined) return;
    counted = true;
    if (point.cost_usd === null) {
      unpriced.add(at);
      return;
    }
    values[at] = (values[at] ?? 0) + point.cost_usd;
  });
  unpriced.forEach((at) => {
    values[at] = null;
  });

  if (!counted) return null;
  return { id: "total", label: "Total", color: TOTAL_COLOR, values };
}

/** The slot the total takes — outside the five the kinds are assigned. */
const TOTAL_COLOR = "series-6" as const;

/**
 * True when a bucket the chart actually plots holds an unpriced event, so the
 * cost lines' gaps can say which ones are omissions rather than quiet stretches.
 *
 * Read from the plotted points alone. `totals` is suppressed as soon as any
 * event anywhere in the range is unpriced, so basing the notice on it prints
 * "buckets are omitted" over a plot where none were.
 */
export function omitsUnpricedBuckets(summary: UsageSummaryRead, buckets: string[]): boolean {
  const plotted = new Set(buckets.map(bucketKey));
  return summary.series.some(
    (point) => point.cost_usd === null && plotted.has(bucketKey(point.bucket_start)),
  );
}

/** Minute-resolution key, so a bucket start matches regardless of how many
 * fractional seconds the API serialized. */
function bucketKey(iso: string): number {
  const date = parseApiDate(iso);
  return Math.floor(date.getTime() / 60_000);
}

export interface UsageBar {
  key: string;
  label: string;
  value: number;
}

export interface UsageBarSet {
  bars: UsageBar[];
  /** Categories dropped for holding an unpriced row — counted, never silent:
   * a panel that just omits them reads as the whole range. */
  unpriced: number;
}

/**
 * Group rows as bar magnitudes for one measure, largest first.
 *
 * Rows in another unit are dropped rather than folded in, so a bar's length is
 * always a count of the one thing its axis names.
 *
 * Under the cost measure every one of a key's rows contributes, so a single
 * unpriced row drops the whole key: a model billed in tokens (priced) and read
 * units (unpriced) would otherwise draw a bar at its token cost alone, labelled
 * as that model's cost — the partial total the ledger exists to never print.
 */
export function buildBars(
  groups: UsageGroupRow[],
  measure: UsageMeasure,
  label: (row: UsageGroupRow) => string,
): UsageBarSet {
  const totals = new Map<string, UsageBar>();
  const unpriced = new Set<string>();
  groups.forEach((row) => {
    if (measure.kind === "quantity" && row.unit !== measure.unit) return;
    const key = row.key ?? "";
    if (measure.kind === "cost" && row.cost_usd === null) {
      unpriced.add(key);
      return;
    }
    const value = measure.kind === "cost" ? (row.cost_usd ?? 0) : row.quantity;
    const existing = totals.get(key);
    if (existing) existing.value += value;
    else totals.set(key, { key, label: label(row), value });
  });
  unpriced.forEach((key) => totals.delete(key));
  return {
    bars: [...totals.values()].sort((a, b) => b.value - a.value),
    unpriced: unpriced.size,
  };
}
