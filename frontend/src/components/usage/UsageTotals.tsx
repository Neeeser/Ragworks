"use client";

import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";
import { formatUsd } from "@/lib/format";

import { UNIT_LABELS } from "./lib/labels";

import type { UsageSummaryRead } from "@/lib/types";

/**
 * The range's totals: dollars, events, and one cell per unit it recorded.
 *
 * Cost is the only value that crosses units, and it is blank whenever any
 * counted event carried no published price — `$0.00` there would claim the
 * providers charged nothing.
 */
export function UsageTotals({
  summary,
  loading,
}: {
  summary: UsageSummaryRead | null;
  loading: boolean;
}) {
  const events = summary?.totals.reduce((count, total) => count + total.event_count, 0) ?? null;
  return (
    <KpiStrip>
      <KpiCell
        label="Cost"
        value={summary?.total_cost_usd == null ? null : formatUsd(summary.total_cost_usd)}
        tooltip="Blank when any counted event in the range carries no published price."
        loading={loading}
      />
      <KpiCell label="Events" value={events} loading={loading} />
      {(summary?.totals ?? []).map((total) => (
        <KpiCell
          key={total.unit}
          label={UNIT_LABELS[total.unit]}
          value={total.quantity}
          loading={loading}
        />
      ))}
    </KpiStrip>
  );
}
