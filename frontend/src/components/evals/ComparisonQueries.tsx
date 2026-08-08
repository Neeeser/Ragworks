"use client";

import { useState } from "react";

import {
  deltaTextClass,
  formatDelta,
  QUERY_KIND_LABEL,
  queryKindCounts,
} from "@/components/evals/lib/comparison";
import { formatMetric } from "@/components/evals/lib/metrics";
import { Chip } from "@/components/ui/chip";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip } from "@/components/ui/tooltip";

import type { EvalQueryDelta } from "@/lib/types";

interface ComparisonQueriesProps {
  queries: EvalQueryDelta[];
  metric: string | null;
  k: number | null;
}

type Filter = "all" | "regressed" | "improved";

/**
 * Every query's headline score on both runs, biggest regression first.
 *
 * The filter is the point of the table: after a change, the question is which
 * queries got worse, and a list ordered by delta answers it without reading
 * every row.
 */
export function ComparisonQueries({ queries, metric, k }: ComparisonQueriesProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = queryKindCounts(queries);
  const visible = queries.filter((query) => filter === "all" || query.kind === filter);

  return (
    <Panel>
      <PanelHeader
        title="Per-query change"
        end={
          metric ? (
            <span className="font-mono text-instrument text-meta">
              {metric}@{k}
            </span>
          ) : null
        }
      />
      {queries.length === 0 ? (
        <p className="p-3 text-ui text-muted">
          {metric
            ? "Neither run has evaluated a query yet."
            : "The two runs computed no metric in common, so no query can be compared."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-3">
            <span className="flex flex-wrap items-center gap-2">
              <Chip tone="pos" dot>
                {counts.improved} improved
              </Chip>
              <Chip tone="neg" dot>
                {counts.regressed} regressed
              </Chip>
              <Chip tone="neutral" dot>
                {counts.unchanged} unchanged
              </Chip>
              {counts.unscored > 0 && (
                <Chip tone="warn" dot>
                  {counts.unscored} not scored
                </Chip>
              )}
              {counts.only_a + counts.only_b > 0 && (
                <Chip tone="warn" dot>
                  {counts.only_a + counts.only_b} in one run only
                </Chip>
              )}
            </span>
            <SegmentedControl
              aria-label="Filter queries"
              value={filter}
              options={[
                { id: "all", label: "All" },
                { id: "regressed", label: "Regressed" },
                { id: "improved", label: "Improved" },
              ]}
              onChange={setFilter}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-96 text-left">
              <caption className="sr-only">Per-query scores on both runs</caption>
              <thead>
                <tr className="border-b border-hairline">
                  <th scope="col" className="px-3 py-2">
                    <InstrumentLabel>Query</InstrumentLabel>
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
                {visible.map((query) => (
                  <QueryRow key={query.query_external_id} query={query} />
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <p className="p-3 text-ui text-muted">
                {filter === "regressed"
                  ? "No query scored lower in run B."
                  : "No query scored higher in run B."}
              </p>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function QueryRow({ query }: { query: EvalQueryDelta }) {
  const degraded = query.degraded_a || query.degraded_b;
  return (
    <tr className="border-b border-hairline last:border-b-0">
      <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-ui text-body">{query.query_text}</span>
          {degraded && (
            <Tooltip
              content={`A node degraded on run ${query.degraded_a ? "A" : "B"} for this query`}
            >
              <span className="shrink-0 text-instrument text-data-warn">degraded</span>
            </Tooltip>
          )}
        </span>
      </th>
      <ScoreCell value={query.value_a} />
      <ScoreCell value={query.value_b} />
      <td
        className={`whitespace-nowrap px-3 py-2 text-right font-mono text-num tabular-nums ${deltaTextClass(query.delta)}`}
      >
        {query.delta === null || query.delta === undefined ? (
          <span className="text-instrument text-muted">{QUERY_KIND_LABEL[query.kind]}</span>
        ) : (
          formatDelta(query.delta)
        )}
      </td>
    </tr>
  );
}

function ScoreCell({ value }: { value: number | null | undefined }) {
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
