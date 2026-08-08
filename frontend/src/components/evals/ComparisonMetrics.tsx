"use client";

import { deltaTextClass, formatDelta, metricDeltaRows } from "@/components/evals/lib/comparison";
import { formatMetric } from "@/components/evals/lib/metrics";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelHeader } from "@/components/ui/panel";

import type { EvalMetricDelta, EvalMetricInfo } from "@/lib/types";

interface ComparisonMetricsProps {
  metrics: EvalMetricDelta[];
  catalog: EvalMetricInfo[];
}

/**
 * Aggregate scores side by side: a row per metric and cutoff, A, B, and the
 * difference. The metric is named once per block, so the cutoffs read down.
 */
export function ComparisonMetrics({ metrics, catalog }: ComparisonMetricsProps) {
  const labels = new Map(catalog.map((metric) => [metric.name, metric.label]));
  const rows = metricDeltaRows(metrics);

  return (
    <Panel>
      <PanelHeader title="Aggregate metrics" />
      {rows.length === 0 ? (
        <p className="p-3 text-ui text-muted">Neither run has scored a metric yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-left">
            <caption className="sr-only">Aggregate metrics on both runs, with the delta</caption>
            <thead>
              <tr className="border-b border-hairline">
                <th scope="col" className="px-3 py-2">
                  <InstrumentLabel>Metric</InstrumentLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  <InstrumentLabel>Run A</InstrumentLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  <InstrumentLabel>Run B</InstrumentLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  <InstrumentLabel>Change</InstrumentLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.metric}@${row.k}`}
                  className="border-b border-hairline last:border-b-0"
                >
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex items-baseline gap-2">
                      <span className="text-ui font-medium text-primary">
                        {row.first ? (labels.get(row.metric) ?? row.metric) : ""}
                      </span>
                      <span className="font-mono text-instrument text-meta">@{row.k}</span>
                    </span>
                  </th>
                  <MetricCell value={row.value_a} />
                  <MetricCell value={row.value_b} />
                  <td
                    className={`px-3 py-2 text-right font-mono text-num tabular-nums ${deltaTextClass(row.delta)}`}
                  >
                    {formatDelta(row.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function MetricCell({ value }: { value: number | null | undefined }) {
  return (
    <td className="px-3 py-2 text-right font-mono text-num tabular-nums text-primary">
      {value === null || value === undefined ? (
        <span className="text-muted">—</span>
      ) : (
        formatMetric(value)
      )}
    </td>
  );
}
