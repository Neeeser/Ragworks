import type { ChartMarker } from "./markers";
import type { TrendSeriesColor } from "./scales";
import type { ChartBrushSpan } from "./use-chart-brush";

export type TrendSeries = {
  id: string;
  label: string;
  color: TrendSeriesColor;
  /** One value per bucket; null = no samples in it (renders a gap). */
  values: Array<number | null>;
  /**
   * Sample count per bucket, when the series is an aggregate. Surfaced in the
   * tooltip so a reader can discount a percentile drawn from one event.
   */
  samples?: Array<number | null>;
};

/**
 * A shaded range behind the series — a spread the line sits inside, such as
 * p50 to p95. One value per bucket, aligned with `buckets`.
 */
export type TrendBand = {
  id: string;
  color: TrendSeriesColor;
  lower: Array<number | null>;
  upper: Array<number | null>;
};

/** One measured event, positioned at its own moment rather than in a bucket. */
export type TrendEvent = {
  id: string;
  /** ISO timestamp; positioned between bucket ticks. */
  at: string;
  value: number;
  color: TrendSeriesColor;
  /** Dot radius in viewBox units — carries magnitude on growth charts. */
  radius?: number;
  /** Dimmed when another series holds focus. */
  muted?: boolean;
  /** Tooltip text for this dot. */
  label?: string;
};

export type TrendChartProps = {
  /** ISO bucket-start datetimes (UTC), one per bucket, oldest first. */
  buckets: string[];
  /** Bucket width in seconds — picks the axis/tooltip label format. */
  bucketSeconds: number;
  series: TrendSeries[];
  /** Shaded spreads drawn behind the series, furthest back first. */
  bands?: TrendBand[];
  /** Individual measurements drawn as dots on top of the series. */
  events?: TrendEvent[];
  /** Fill the area under the first series (single-series growth charts). */
  area?: boolean;
  /** Hold each value until the next sample instead of interpolating. */
  step?: boolean;
  height?: number;
  formatValue: (value: number) => string;
  /** Override the axis label format (e.g. UTC days from a truncating endpoint). */
  formatBucket?: (iso: string) => string;
  /** Pipeline changes to mark on the axis. */
  markers?: ChartMarker[];
  /** Enables drag- and keyboard-selection; called with the committed span. */
  onBrush?: (span: ChartBrushSpan) => void;
  /** Called on Escape, to clear a zoom the parent is holding. */
  onResetBrush?: () => void;
  /** Accessible name for the chart region. */
  label?: string;
  className?: string;
};

export type { ChartMarker, ChartBrushSpan, TrendSeriesColor };
export type { TrendBand as ChartBand, TrendEvent as ChartEvent };
