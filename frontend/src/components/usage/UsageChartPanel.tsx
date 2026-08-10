"use client";

import { Panel, PanelHeader } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { COLOR_VAR, TrendChart, utcDayLabel } from "@/components/ui/trend-chart";

import { EMPTY_RANGE_COPY } from "./lib/labels";
import { bucketSeconds } from "./lib/range";
import {
  buildKindSeries,
  buildTotalCostSeries,
  formatMeasure,
  omitsUnpricedBuckets,
  measureId,
  measureLabel,
} from "./lib/series";

import type { UsageMeasure } from "./lib/series";
import type { SegmentedOption } from "@/components/ui/segmented-control";
import type { TrendSeries } from "@/components/ui/trend-chart";
import type { UsageBucket, UsageSummaryRead } from "@/lib/types";

type UsageChartPanelProps = {
  summary: UsageSummaryRead | null;
  buckets: string[];
  bucket: UsageBucket;
  measure: UsageMeasure | null;
  measures: UsageMeasure[];
  onMeasureChange: (id: string) => void;
  loading: boolean;
};

/** The chart's plot area, held at its final height while the data loads. */
const PLOT = "h-[132px] w-full";

/**
 * Spend over the range: one line per kind, plus the total under the cost
 * measure — dollars are the one figure that crosses units, and a reader asking
 * what the range cost should not have to add five lines up by eye.
 *
 * The measure is a control rather than a fixed axis because a range can hold
 * tokens, search units and read units at once, and one axis carrying all three
 * would be a number nobody measured. Dollars are the default whenever anything
 * in the range was priced.
 */
export function UsageChartPanel({
  summary,
  buckets,
  bucket,
  measure,
  measures,
  onMeasureChange,
  loading,
}: UsageChartPanelProps) {
  const options: Array<SegmentedOption<string>> = measures.map((entry) => ({
    id: measureId(entry),
    label: measureLabel(entry),
  }));
  const series = chartSeries(summary, buckets, measure);
  const omitsUnpriced = Boolean(
    summary && measure?.kind === "cost" && omitsUnpricedBuckets(summary, buckets),
  );

  return (
    <Panel>
      <PanelHeader
        title="Spend over time"
        end={
          options.length > 1 && measure ? (
            <SegmentedControl
              aria-label="Measure"
              options={options}
              value={measureId(measure)}
              onChange={onMeasureChange}
            />
          ) : null
        }
      />
      <div className="p-3">
        {loading && !summary ? (
          <Skeleton className={PLOT} />
        ) : series.length === 0 ? (
          <p className="py-8 text-center text-ui text-muted">{EMPTY_RANGE_COPY}</p>
        ) : (
          <>
            <TrendChart
              buckets={buckets}
              bucketSeconds={bucketSeconds(bucket)}
              formatBucket={bucket === "day" ? utcDayLabel : undefined}
              height={132}
              label={`${measure ? measureLabel(measure) : "Usage"} per ${bucket}, by kind`}
              series={series}
              formatValue={(value) => (measure ? formatMeasure(measure, value) : `${value}`)}
            />
            <ChartLegend series={series} />
            {omitsUnpriced ? (
              <p className="mt-2 text-instrument text-meta">
                Buckets containing unpriced events are omitted from the cost lines.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * The lines the plot draws: one per kind, and the total above them under the
 * cost measure.
 */
function chartSeries(
  summary: UsageSummaryRead | null,
  buckets: string[],
  measure: UsageMeasure | null,
): TrendSeries[] {
  if (!summary || !measure) return [];
  const kinds = buildKindSeries(summary, buckets, measure);
  if (measure.kind !== "cost") return kinds;
  // Drawn last so it sits above the per-kind lines it sums.
  const total = buildTotalCostSeries(summary, buckets);
  return total ? [...kinds, total] : kinds;
}

/** Two or more series always carry a legend, so identity never rests on colour
 * alone; a single series is named by the panel title instead. */
function ChartLegend({ series }: { series: TrendSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {series.map((entry) => (
        <li key={entry.id} className="flex items-center gap-1.5 text-instrument text-muted">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-[2px]"
            style={{ background: COLOR_VAR[entry.color] }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
