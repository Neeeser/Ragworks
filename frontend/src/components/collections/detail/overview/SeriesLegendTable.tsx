"use client";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { formatLatency } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { TrendSeriesColor } from "@/components/ui/trend-chart";
import type { LatencySummary } from "@/lib/types";

export type LegendRow = {
  key: string;
  name: string;
  color: TrendSeriesColor;
  summary: LatencySummary;
};

const COLUMNS = [
  { label: "Queries", read: (summary: LatencySummary) => summary.count.toLocaleString() },
  { label: "avg", read: (summary: LatencySummary) => formatLatency(summary.avg_ms ?? null) },
  { label: "p50", read: (summary: LatencySummary) => formatLatency(summary.p50_ms ?? null) },
  { label: "p95", read: (summary: LatencySummary) => formatLatency(summary.p95_ms ?? null) },
  { label: "p99", read: (summary: LatencySummary) => formatLatency(summary.p99_ms ?? null) },
  { label: "max", read: (summary: LatencySummary) => formatLatency(summary.max_ms ?? null) },
] as const;

type SeriesLegendTableProps = {
  rows: LegendRow[];
  visible: Set<string>;
  onToggle: (key: string) => void;
  /** Expanded rows carry the full percentile columns; collapsed carry one number. */
  expanded: boolean;
};

/**
 * The legend and the stats table are one control at two densities.
 *
 * Collapsed it is a swatch, a name and a headline number per series; expanded
 * the same rows gain percentile columns. Keeping them one component means the
 * toggle and the numbers sit on the same row, so there is no colour-matching
 * between two surfaces.
 */
export function SeriesLegendTable({ rows, visible, onToggle, expanded }: SeriesLegendTableProps) {
  if (rows.length === 0) return null;

  // The header is hidden but still announced when collapsed, so it must list
  // the columns the rows actually carry — heading the lone average with
  // "Queries" is what a screen reader would otherwise read out.
  const columns = expanded ? COLUMNS : COLUMNS.slice(1, 2);

  return (
    <div className={cn(expanded && "overflow-x-auto")}>
      <table className="w-full border-collapse">
        <thead className={cn(!expanded && "sr-only")}>
          <tr className="text-left">
            <th scope="col" className="pb-1 pr-3">
              <InstrumentLabel>Tool</InstrumentLabel>
            </th>
            {columns.map((column) => (
              <th key={column.label} scope="col" className="pb-1 pl-3 text-right">
                <InstrumentLabel>{column.label}</InstrumentLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shown = visible.has(row.key);
            return (
              <tr key={row.key} className="border-t border-hairline first:border-t-0">
                <th scope="row" className="w-full py-1 pr-3 font-normal">
                  <button
                    type="button"
                    onClick={() => onToggle(row.key)}
                    aria-pressed={shown}
                    className="flex items-center gap-2 rounded-control text-left text-ui text-body transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-canvas focus-visible:outline-none"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-[2px] transition-opacity"
                      style={{
                        background: `var(--${row.color === "neutral" ? "port-default" : row.color})`,
                        opacity: shown ? 1 : 0.3,
                      }}
                      aria-hidden
                    />
                    <span className={cn("truncate", !shown && "text-meta line-through")}>
                      {row.name}
                    </span>
                  </button>
                </th>
                {columns.map((column) => (
                  <td
                    key={column.label}
                    className="py-1 pl-3 text-right font-mono text-ui whitespace-nowrap tabular-nums text-primary"
                  >
                    {column.read(row.summary)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
