"use client";

import { Panel, PanelHeader } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { COLOR_VAR, TrendChart, utcDayLabel } from "@/components/ui/trend-chart";

import { bucketSeconds } from "./lib/range";
import { buildKindSeries, formatMeasure, measureId, measureLabel } from "./lib/series";

import type { UsageMeasure } from "./lib/series";
import type { SegmentedOption } from "@/components/ui/segmented-control";
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
 * Spend over the range, one line per kind.
 *
 * The measure is a control rather than a fixed axis because a range can hold
 * tokens, search units and read units at once, and one axis carrying all three
 * would be a number nobody measured. Dollars are the only figure that crosses
 * units, so they are the default whenever anything in the range was priced.
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
  const series = summary && measure ? buildKindSeries(summary, buckets, measure) : [];

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
          <p className="py-8 text-center text-ui text-muted">No usage recorded in this range.</p>
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
            {/* Two or more series always carry a legend: identity never rests
                on colour alone. */}
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
          </>
        )}
      </div>
    </Panel>
  );
}
