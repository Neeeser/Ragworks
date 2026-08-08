/** Pure helpers for displaying the diff between two eval runs. */

import type { StatusTone } from "@/components/ui/status-dot";
import type { EvalMetricDelta, EvalQueryDelta, EvalQueryDeltaKind } from "@/lib/types";

/** One metric-at-cutoff row, carrying whether it opens a new metric block. */
export interface MetricDeltaRow extends EvalMetricDelta {
  /** True on the first cutoff of a metric, so the label prints once per block. */
  first: boolean;
}

/**
 * A row per metric and cutoff, with the metric named only on its first row.
 *
 * Every value here is the same kind of number at a different depth, so one
 * table reading A / B / delta down the cutoffs beats a card per metric.
 */
export function metricDeltaRows(metrics: EvalMetricDelta[]): MetricDeltaRow[] {
  let previous: string | null = null;
  return metrics.map((entry) => {
    const first = entry.metric !== previous;
    previous = entry.metric;
    return { ...entry, first };
  });
}

/** A signed delta at two decimals; an absent value is an em-dash, never a zero. */
export function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  if (Math.abs(delta) < 0.005) return "0.00";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;
}

/** A signed retention delta in percentage points. */
export function formatPercentDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  const points = Math.round(delta * 100);
  if (points === 0) return "0 pt";
  return `${points > 0 ? "+" : "−"}${Math.abs(points)} pt`;
}

/**
 * The tone a delta wears. Every metric and retention figure here is
 * higher-is-better, so up is positive; a delta inside display precision is
 * neutral rather than a coloured non-movement.
 */
export function deltaTone(delta: number | null | undefined): StatusTone {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "neutral";
  if (delta > 0.005) return "pos";
  if (delta < -0.005) return "neg";
  return "neutral";
}

/** The Tailwind text token for a delta's tone. */
export function deltaTextClass(delta: number | null | undefined): string {
  const tone = deltaTone(delta);
  if (tone === "pos") return "text-data-pos";
  if (tone === "neg") return "text-data-neg";
  return "text-muted";
}

export const QUERY_KIND_LABEL: Record<EvalQueryDeltaKind, string> = {
  improved: "Improved",
  regressed: "Regressed",
  unchanged: "Unchanged",
  only_a: "Run A only",
  only_b: "Run B only",
};

/** How many queries landed in each movement class. */
export function queryKindCounts(queries: EvalQueryDelta[]): Record<EvalQueryDeltaKind, number> {
  const counts: Record<EvalQueryDeltaKind, number> = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    only_a: 0,
    only_b: 0,
  };
  for (const query of queries) counts[query.kind] += 1;
  return counts;
}

/** A run's display name, falling back to a short form of its id. */
export function runLabel(run: { id: string; name?: string | null }): string {
  return run.name || `Run ${run.id.slice(0, 8)}`;
}
