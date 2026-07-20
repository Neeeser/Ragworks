"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { goldHitCount } from "@/components/evals/lib/journey";
import { formatMetric, itemMetricNames } from "@/components/evals/lib/metrics";
import { QueryDrilldown } from "@/components/evals/QueryDrilldown";
import { GlassCard } from "@/components/ui/panel";
import { truncate } from "@/lib/utils";

import type { EvalMetricInfo, EvalRunItem, FunnelStage } from "@/lib/types";

interface ItemsTableProps {
  items: EvalRunItem[];
  documentTitles: Record<string, string>;
  stages: FunnelStage[];
  kValues: number[];
  catalog?: EvalMetricInfo[];
}

/**
 * Per-query results. Each row expands into the query's expected documents
 * (with their stage paths) and returned results; the trace link opens the
 * query-event trace, where focusing a result joins in its ingestion origin.
 */
export function ItemsTable({ items, documentTitles, stages, kValues, catalog }: ItemsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (items.length === 0) {
    return null;
  }
  const headlineK = kValues.length ? Math.max(...kValues) : 10;
  // Columns come from the metrics the run actually computed, in catalog order.
  const metricNames = itemMetricNames(items, headlineK, catalog ?? []);
  const labels = new Map((catalog ?? []).map((metric) => [metric.name, metric.label]));

  return (
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Queries</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              <th className="w-8 py-2 pr-2 font-normal">
                <span className="sr-only">Expand</span>
              </th>
              <th className="py-2 pr-4 font-normal">Query</th>
              <th className="py-2 pr-4 font-normal">Gold found</th>
              <th className="py-2 pr-4 font-normal">Returned</th>
              {metricNames.map((name) => (
                <th key={name} className="py-2 pr-4 font-normal">
                  {metricColumnHeader(name, labels.get(name), headlineK)}
                </th>
              ))}
              <th className="py-2 font-normal">Trace</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const expanded = expandedId === item.id;
              const hits = goldHitCount(item);
              return (
                <Fragment key={item.id}>
                  <tr className="border-b border-hairline align-top last:border-b-0">
                    <td className="py-3 pr-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} query ${item.query_external_id}`}
                        className="rounded-full p-1 text-muted transition hover:bg-surface-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" aria-hidden />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    </td>
                    <td className="max-w-md py-3 pr-4 text-body">
                      {truncate(item.query_text, 120)}
                      {item.failed && (
                        <p className="mt-1 text-xs text-data-neg">
                          {item.error_message || "Query failed"}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      <span
                        className={hits < item.gold_doc_ids.length ? "text-data-warn" : "text-body"}
                      >
                        {hits}/{item.gold_doc_ids.length}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-body">{item.result_count}</td>
                    {metricNames.map((name) => (
                      <td key={name} className="py-3 pr-4 font-mono text-xs text-primary">
                        {item.failed ? "—" : formatMetric(item.metrics[`${name}@${headlineK}`])}
                      </td>
                    ))}
                    <td className="py-3">
                      <TraceLink item={item} />
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-hairline last:border-b-0">
                      <td colSpan={5 + metricNames.length} className="p-0">
                        <QueryDrilldown
                          item={item}
                          stages={stages}
                          documentTitles={documentTitles}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

/** Catalog labels read `Recall@k`; the column pins the run's actual cutoff. */
function metricColumnHeader(name: string, label: string | undefined, k: number): string {
  const base = (label ?? name).replace(/@k$/i, "");
  return `${base}@${k}`;
}

function TraceLink({ item }: { item: EvalRunItem }) {
  const href = item.query_event_id
    ? `/traces/queries/${item.query_event_id}`
    : item.pipeline_run_id
      ? `/traces/runs/${item.pipeline_run_id}`
      : null;
  if (!href) {
    return <span className="text-meta">—</span>;
  }
  return (
    <Link
      href={href}
      className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent-cyan underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent-violet"
    >
      Open
    </Link>
  );
}
