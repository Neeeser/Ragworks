"use client";

import { useMemo, useState } from "react";

import { SeriesLegendTable } from "@/components/collections/detail/overview/SeriesLegendTable";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TrendChart } from "@/components/ui/trend-chart";
import { formatLatency } from "@/lib/format";

import type { LegendRow } from "@/components/collections/detail/overview/SeriesLegendTable";
import type { SegmentedOption } from "@/components/ui/segmented-control";
import type {
  ChartBrushSpan,
  ChartMarker,
  TrendSeries,
  TrendSeriesColor,
} from "@/components/ui/trend-chart";
import type { CollectionStatsHistoryPoint, ToolLatencySeries } from "@/lib/types";

type LatencyMetric = "avg_ms" | "p50_ms" | "p95_ms" | "max_ms";

const METRICS: Array<SegmentedOption<LatencyMetric>> = [
  { id: "avg_ms", label: "avg" },
  { id: "p50_ms", label: "p50" },
  { id: "p95_ms", label: "p95" },
  { id: "max_ms", label: "max" },
];

/**
 * How many tool lines are drawn before the chart stops being readable.
 * Categorical palettes lose separability past six hues at line weight; the
 * legend still lists every tool, so nothing is hidden — only undrawn.
 */
const DEFAULT_VISIBLE_TOOLS = 6;

type RetrievalLatencyCardProps = {
  points: CollectionStatsHistoryPoint[];
  tools: ToolLatencySeries[];
  toolColors: Map<string, TrendSeriesColor>;
  buckets: string[];
  bucketSeconds: number;
  markers: ChartMarker[];
  onBrush: (span: ChartBrushSpan) => void;
  onResetBrush: () => void;
};

/**
 * Query latency per bound tool. One line each, so a version marker can be read
 * against the tool it actually changed rather than against a blended average.
 */
export function RetrievalLatencyCard({
  points,
  tools,
  toolColors,
  buckets,
  bucketSeconds,
  markers,
  onBrush,
  onResetBrush,
}: RetrievalLatencyCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [metric, setMetric] = useState<LatencyMetric>("avg_ms");
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

  const series = useMemo<TrendSeries[]>(
    () =>
      ranked
        .filter((tool) => visible.has(tool.key))
        .map((tool) => ({
          id: tool.key,
          label: tool.name,
          color: toolColors.get(tool.key) ?? "neutral",
          values: points.map((point) => point.tools[tool.key]?.[metric] ?? null),
          samples: points.map((point) => point.tools[tool.key]?.count ?? null),
        })),
    [metric, points, ranked, toolColors, visible],
  );

  const toggle = (key: string) => {
    setChosen((current) => {
      const next = new Set(current ?? defaults);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalQueries = tools.reduce((sum, tool) => sum + tool.summary.count, 0);

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InstrumentLabel className="text-body">Retrieval latency</InstrumentLabel>
        <div className="flex items-center gap-2">
          <SegmentedControl
            aria-label="Latency metric"
            options={METRICS}
            value={metric}
            onChange={setMetric}
          />
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="rounded-control border border-hairline px-2 py-1 text-instrument font-medium text-muted transition hover:border-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      {totalQueries > 0 ? (
        <>
          <TrendChart
            className="mt-2"
            buckets={buckets}
            bucketSeconds={bucketSeconds}
            height={104}
            series={series}
            markers={markers}
            label="Retrieval latency per tool"
            formatValue={(value) => formatLatency(value)}
            onBrush={onBrush}
            onResetBrush={onResetBrush}
          />
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
