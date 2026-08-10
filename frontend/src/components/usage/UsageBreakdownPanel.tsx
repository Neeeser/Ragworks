"use client";

import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { COLOR_VAR } from "@/components/ui/trend-chart";
import { cn } from "@/lib/utils";

import { groupRowIsIdentifier, groupRowLabel } from "./lib/labels";
import { buildBars, formatMeasure, measureLabel } from "./lib/series";

import type { UsageMeasure } from "./lib/series";
import type { UsageGroupBy, UsageGroupRow } from "@/lib/types";

type UsageBreakdownPanelProps = {
  title: string;
  dimension: UsageGroupBy;
  groups: UsageGroupRow[];
  measure: UsageMeasure | null;
  loading: boolean;
};

/**
 * A dimension's share of the range as horizontal bars — a count per category,
 * so bars rather than a chart with a time axis.
 *
 * Bars carry one measure at a time. A row measured in another unit is left out
 * rather than added in, because the bar's length would then be a sum of
 * different things.
 */
export function UsageBreakdownPanel({
  title,
  dimension,
  groups,
  measure,
  loading,
}: UsageBreakdownPanelProps) {
  const bars = measure
    ? buildBars(groups, measure, (row) => groupRowLabel(dimension, row.key, row.label))
    : [];
  const max = bars.reduce((peak, bar) => Math.max(peak, bar.value), 0);
  const mono = groupRowIsIdentifier(dimension);

  return (
    <Panel>
      <PanelHeader
        title={title}
        as="h3"
        end={
          measure ? (
            <span className="text-instrument text-meta">{measureLabel(measure)}</span>
          ) : null
        }
      />
      <div className="flex flex-col gap-2 p-3">
        {loading && bars.length === 0 ? (
          <Skeleton className="h-24 w-full" />
        ) : bars.length === 0 ? (
          <p className="py-6 text-center text-ui text-muted">Nothing recorded in this range.</p>
        ) : (
          bars.map((bar) => (
            <div key={bar.key} className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-ui text-body",
                  mono && "font-mono text-instrument",
                )}
              >
                {bar.label}
              </span>
              <span
                aria-hidden
                className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface sm:w-40"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    background: COLOR_VAR["series-1"],
                    width: `${max > 0 ? Math.max(2, (bar.value / max) * 100) : 0}%`,
                  }}
                />
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-ui tabular-nums text-primary">
                {measure ? formatMeasure(measure, bar.value) : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
