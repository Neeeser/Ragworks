"use client";

import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { COLOR_VAR } from "@/components/ui/trend-chart";
import { cn } from "@/lib/utils";

import { EMPTY_RANGE_COPY, groupRowIsIdentifier, groupRowLabel } from "./lib/labels";
import { buildBars, formatMeasure, measureLabel } from "./lib/series";

import type { UsageMeasure } from "./lib/series";
import type { UsageGroupBy, UsageGroupRow } from "@/lib/types";

type UsageBreakdownPanelProps = {
  title: string;
  dimension: UsageGroupBy;
  groups: UsageGroupRow[];
  measure: UsageMeasure | null;
  /** A failed fetch for this dimension — reported here rather than left to
   * render as an empty range, which would blame the data for an outage. */
  error: string | null;
  loading: boolean;
};

/** Categories drawn as bars; the remainder is counted in a line below. */
const VISIBLE_BARS = 6;

/**
 * A dimension's share of the range as horizontal bars — a count per category,
 * so bars rather than a chart with a time axis.
 *
 * Bars carry one measure at a time. A row measured in another unit is left out
 * rather than added in, because the bar's length would then be a sum of
 * different things.
 *
 * Only the leading categories get a bar; the rest are counted rather than
 * dropped silently, so the panel never reads as the whole range when it is
 * showing part of it.
 */
export function UsageBreakdownPanel({
  title,
  dimension,
  groups,
  measure,
  error,
  loading,
}: UsageBreakdownPanelProps) {
  const set = measure
    ? buildBars(groups, measure, (row) => groupRowLabel(dimension, row.key, row.label))
    : { bars: [], unpriced: 0 };
  const bars = set.bars.slice(0, VISIBLE_BARS);
  const omissions = [
    set.bars.length > bars.length ? `+${set.bars.length - bars.length} more not shown` : null,
    // A category dropped for holding an unpriced row is invisible in the bars,
    // so the panel would otherwise read as the whole range.
    set.unpriced > 0 ? `${set.unpriced} with an unpriced unit omitted` : null,
  ].filter((note): note is string => note !== null);
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
        {error ? (
          <p role="alert" className="py-6 text-center text-ui text-data-neg">
            {error}
          </p>
        ) : loading && bars.length === 0 ? (
          <Skeleton className="h-24 w-full" />
        ) : bars.length === 0 ? (
          <p className="py-6 text-center text-ui text-muted">{EMPTY_RANGE_COPY}</p>
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
        {omissions.length > 0 ? (
          <p className="text-instrument text-meta">{omissions.join(" · ")}</p>
        ) : null}
      </div>
    </Panel>
  );
}
