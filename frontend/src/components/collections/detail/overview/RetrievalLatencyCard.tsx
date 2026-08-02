"use client";

import { useMemo, useState } from "react";

import { SeriesLegendTable } from "@/components/collections/detail/overview/SeriesLegendTable";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { TrendChart } from "@/components/ui/trend-chart";
import { formatLatency } from "@/lib/format";

import { ChartLegend } from "./IngestionLatencyCard";
import { latencyBand, latencyDots } from "./lib/chart-series";

import type { LegendRow } from "@/components/collections/detail/overview/SeriesLegendTable";
import type {
  ChartBrushSpan,
  ChartMarker,
  TrendSeries,
  TrendSeriesColor,
} from "@/components/ui/trend-chart";
import type {
  CollectionStatsHistoryPoint,
  LatencyEvent,
  LatencySummary,
  ToolLatencySeries,
} from "@/lib/types";

/**
 * How many tool series are lit at once before the chart stops being readable.
 * Categorical palettes lose separability past six hues; the legend still lists
 * every tool, so nothing is hidden — only dimmed.
 */
const DEFAULT_VISIBLE_TOOLS = 6;

type RetrievalLatencyCardProps = {
  points: CollectionStatsHistoryPoint[];
  tools: ToolLatencySeries[];
  summary: LatencySummary;
  events: LatencyEvent[];
  sampled: boolean;
  toolColors: Map<string, TrendSeriesColor>;
  buckets: string[];
  bucketSeconds: number;
  markers: ChartMarker[];
  onBrush: (span: ChartBrushSpan) => void;
  onResetBrush: () => void;
};

/**
 * Query latency: every query as a dot, over the median line and p50–p95 band.
 *
 * The band and line describe retrieval as a whole while more than one tool is
 * lit, and narrow to a single tool's own spread when only that one is — so
 * "did v2 make this tool faster" is answered by selecting it, without a second
 * control to learn. Selecting alone is what focuses; the dots of unselected
 * tools stay drawn but dimmed, because a tool's traffic is context for the
 * one being read even when it is not the subject.
 */
export function RetrievalLatencyCard({
  points,
  tools,
  summary,
  events,
  sampled,
  toolColors,
  buckets,
  bucketSeconds,
  markers,
  onBrush,
  onResetBrush,
}: RetrievalLatencyCardProps) {
  const [expanded, setExpanded] = useState(false);
  /** Null until the user picks; their selection then survives background refetches. */
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  const ranked = useMemo(
    () => [...tools].sort((a, b) => b.summary.count - a.summary.count),
    [tools],
  );

  const defaults = useMemo(
    () => new Set(ranked.slice(0, DEFAULT_VISIBLE_TOOLS).map((tool) => tool.key)),
    [ranked],
  );
  const visible = chosen ?? defaults;

  // One selected tool means the reader is looking at that tool, so the summary
  // line narrows to it. Two or more, and a per-tool band would be six shaded
  // shapes overlapping — the combined spread is the only readable answer.
  const focused = visible.size === 1 ? [...visible][0] : null;
  const focusedTool = focused === null ? null : ranked.find((tool) => tool.key === focused);

  const rows = useMemo<LegendRow[]>(
    () =>
      ranked.map((tool) => ({
        key: tool.key,
        name: tool.name,
        color: toolColors.get(tool.key) ?? "neutral",
        summary: tool.summary,
      })),
    [ranked, toolColors],
  );

  const color: TrendSeriesColor =
    focused === null ? "series-1" : (toolColors.get(focused) ?? "neutral");
  const read = useMemo(
    () =>
      focused === null
        ? (point: CollectionStatsHistoryPoint) => point.retrieval
        : (point: CollectionStatsHistoryPoint) => point.tools[focused] ?? { count: 0 },
    [focused],
  );

  const series = useMemo<TrendSeries[]>(
    () => [
      {
        id: "median",
        label: focusedTool ? `${focusedTool.name} median` : "Median",
        color,
        values: points.map((point) => read(point).p50_ms ?? null),
        samples: points.map((point) => read(point).count || null),
      },
    ],
    [color, focusedTool, points, read],
  );
  const bands = useMemo(() => [latencyBand(points, read, color)], [color, points, read]);

  const dots = useMemo(
    () =>
      latencyDots(
        events,
        (key) => (key ? (toolColors.get(key) ?? "neutral") : "neutral"),
        formatLatency,
        (key) => visible.has(key ?? ""),
      ),
    [events, toolColors, visible],
  );

  const toggle = (key: string) => {
    setChosen((current) => {
      const next = new Set(current ?? defaults);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const shown = focusedTool?.summary ?? summary;

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <InstrumentLabel className="text-body">Retrieval latency</InstrumentLabel>
          {shown.count > 0 && (
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-ui tabular-nums text-primary">
                {formatLatency(shown.p50_ms ?? null)}
              </span>
              <InstrumentLabel>median</InstrumentLabel>
              <span className="font-mono text-ui tabular-nums text-primary">
                {formatLatency(shown.p95_ms ?? null)}
              </span>
              <InstrumentLabel>p95</InstrumentLabel>
              <span className="font-mono text-ui tabular-nums text-primary">
                {formatLatency(shown.max_ms ?? null)}
              </span>
              <InstrumentLabel>max</InstrumentLabel>
              <span className="font-mono text-ui tabular-nums text-primary">
                {shown.count.toLocaleString()}
              </span>
              <InstrumentLabel>queries</InstrumentLabel>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="rounded-control border border-hairline px-2 py-1 text-instrument font-medium text-muted transition hover:border-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
      </div>

      {summary.count > 0 ? (
        <>
          <TrendChart
            className="mt-2"
            buckets={buckets}
            bucketSeconds={bucketSeconds}
            height={128}
            series={series}
            bands={bands}
            events={dots}
            markers={markers}
            label="Retrieval latency"
            formatValue={(value) => formatLatency(value)}
            onBrush={onBrush}
            onResetBrush={onResetBrush}
          />
          <ChartLegend sampled={sampled} unit="queries" />
          <div className="mt-2 border-t border-hairline pt-2">
            <SeriesLegendTable
              rows={rows}
              visible={visible}
              onToggle={toggle}
              expanded={expanded}
            />
          </div>
        </>
      ) : (
        <p className="mt-2 text-ui text-muted">No queries recorded in this range.</p>
      )}
    </Panel>
  );
}
