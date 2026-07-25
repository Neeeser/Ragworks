"use client";

import { HelpCircle } from "lucide-react";

import { formatMetric, groupMetrics, metricCutoffs } from "@/components/evals/lib/metrics";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";

import type { EvalMetricInfo } from "@/lib/types";

interface MetricCardsProps {
  aggregates: Record<string, number>;
  catalog: EvalMetricInfo[];
}

/**
 * The run's aggregate scores: one row per metric, one column per k cutoff.
 *
 * A grid rather than a card per metric — every value here is the same kind of
 * number at a different depth, so a shared column reads down the cutoffs and
 * across the metrics at once, which a row of separate cards cannot.
 */
export function MetricCards({ aggregates, catalog }: MetricCardsProps) {
  const groups = groupMetrics(aggregates, catalog);
  if (groups.length === 0) {
    return (
      <Panel className="p-3">
        <p className="text-ui text-muted">Metrics land as queries complete.</p>
      </Panel>
    );
  }
  const cutoffs = metricCutoffs(groups);

  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-96 text-left">
        <caption className="sr-only">Aggregate metrics by cutoff</caption>
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className="px-3 py-2">
              <InstrumentLabel>Metric</InstrumentLabel>
            </th>
            {cutoffs.map((k) => (
              <th key={k} scope="col" className="px-3 py-2 text-right">
                <InstrumentLabel>@{k}</InstrumentLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const byCutoff = new Map(group.values.map((entry) => [entry.k, entry.value]));
            return (
              <tr key={group.name} className="border-b border-hairline last:border-b-0">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-1.5">
                    <span className="text-ui font-medium text-primary">{group.label}</span>
                    {group.description && (
                      <Tooltip content={group.description}>
                        <span
                          tabIndex={0}
                          role="img"
                          aria-label={`What ${group.label} measures`}
                          className="rounded-control text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </th>
                {cutoffs.map((k) => {
                  const value = byCutoff.get(k);
                  return (
                    <td
                      key={k}
                      className="px-3 py-2 text-right font-mono text-num tabular-nums text-primary"
                    >
                      {value === undefined ? (
                        <span className="text-muted">—</span>
                      ) : (
                        formatMetric(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
