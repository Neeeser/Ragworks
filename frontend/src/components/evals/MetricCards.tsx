"use client";

import { HelpCircle } from "lucide-react";

import { formatMetric, groupMetrics } from "@/components/evals/lib/metrics";
import { Tooltip } from "@/components/ui/tooltip";

import type { EvalMetricInfo } from "@/lib/types";

interface MetricCardsProps {
  aggregates: Record<string, number>;
  catalog: EvalMetricInfo[];
}

export function MetricCards({ aggregates, catalog }: MetricCardsProps) {
  const groups = groupMetrics(aggregates, catalog);
  if (groups.length === 0) {
    return <p className="text-sm text-muted">Metrics land as queries complete.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <div key={group.name} className="rounded-3xl border border-hairline bg-surface p-4">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              {group.label}
            </p>
            {group.description && (
              <Tooltip content={group.description}>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={`What ${group.label} measures`}
                  className="text-muted focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </span>
              </Tooltip>
            )}
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {group.values.map((entry) => (
              <div key={entry.k}>
                <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-meta">
                  @{entry.k}
                </dt>
                <dd className="mt-0.5 font-mono text-lg text-primary">
                  {formatMetric(entry.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
