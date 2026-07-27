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

export type TrendChartProps = {
  /** ISO bucket-start datetimes (UTC), one per bucket, oldest first. */
  buckets: string[];
  /** Bucket width in seconds — picks the axis/tooltip label format. */
  bucketSeconds: number;
  series: TrendSeries[];
  /** Fill the area under the first series (single-series growth charts). */
  area?: boolean;
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
