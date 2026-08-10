"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

import { goldHitCount } from "@/components/evals/lib/journey";
import { formatMetric, itemMetricNames } from "@/components/evals/lib/metrics";
import { QueryDrilldown } from "@/components/evals/QueryDrilldown";
import { MediaThumbnail } from "@/components/ui/asset-image";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { truncate } from "@/lib/utils";

import type { EvalMetricInfo, EvalRunItem, FunnelStage } from "@/lib/types";

interface ItemsTableProps {
  items: EvalRunItem[];
  documentTitles: Record<string, string>;
  stages: FunnelStage[];
  kValues: number[];
  catalog?: EvalMetricInfo[];
}

/** One query's identity in the results table: its text, its image, or both. */
function QueryCell({ item }: { item: EvalRunItem }) {
  return (
    <>
      {item.query_text ? truncate(item.query_text, 120) : null}
      <MediaThumbnail
        media={item.query_media}
        alt={`Query image for ${item.query_external_id}`}
        className="mt-1 max-h-24"
      />
    </>
  );
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
    <Panel>
      <PanelHeader
        title="Queries"
        end={
          <span className="font-mono text-instrument tabular-nums text-meta">
            {items.length.toLocaleString()} evaluated
          </span>
        }
      />

      {/* The table scrolls inside the card rather than the page. */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline">
              <th scope="col" className="w-8 py-2 pl-3 pr-1">
                <span className="sr-only">Expand</span>
              </th>
              <th scope="col" className="py-2 pr-3">
                <InstrumentLabel>Query</InstrumentLabel>
              </th>
              <th scope="col" className="w-24 py-2 pr-3 text-right">
                <InstrumentLabel>Gold found</InstrumentLabel>
              </th>
              <th scope="col" className="w-20 py-2 pr-3 text-right">
                <InstrumentLabel>Returned</InstrumentLabel>
              </th>
              {metricNames.map((name) => (
                <th key={name} scope="col" className="w-24 py-2 pr-3 text-right">
                  <InstrumentLabel>
                    {metricColumnHeader(name, labels.get(name), headlineK)}
                  </InstrumentLabel>
                </th>
              ))}
              <th scope="col" className="w-20 py-2 pr-3 text-right">
                <InstrumentLabel>Trace</InstrumentLabel>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const expanded = expandedId === item.id;
              const hits = goldHitCount(item);
              const partial = hits < item.gold_doc_ids.length;
              // Gold that never reached the index: the retriever was never
              // given the chance to return it, so this query carries no
              // metrics at all rather than a row of zeros that reads as a
              // bad result.
              const unscored =
                !item.failed &&
                item.gold_doc_ids.length > 0 &&
                item.indexed_gold_doc_ids.length === 0;
              const missingGold = item.gold_doc_ids.length - item.indexed_gold_doc_ids.length;
              return (
                <Fragment key={item.id}>
                  <tr className="border-b border-hairline align-top last:border-b-0">
                    <td className="py-2 pl-3 pr-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} query ${item.query_external_id}`}
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </Button>
                    </td>
                    <td className="max-w-md py-3 pr-3 text-ui text-body">
                      {/* An image query carries no text — the picture it asked
                          with is what identifies the row. */}
                      <QueryCell item={item} />
                      {item.failed && (
                        <p className="mt-1 text-instrument text-data-neg">
                          {item.error_message || "Query failed"}
                        </p>
                      )}
                      {unscored && (
                        <p className="mt-1 text-instrument text-data-warn">
                          Not scored — no gold document reached the index.
                        </p>
                      )}
                      {/* This query's metrics are in the columns to the right
                          and in the run's aggregate, so the row itself has to
                          say they came from a pipeline that partly did not
                          run. */}
                      {item.degraded && (
                        <p className="mt-1 text-instrument text-data-warn">
                          Degraded — a node passed its input through after its provider failed.
                        </p>
                      )}
                      {!unscored && missingGold > 0 && (
                        <p className="mt-1 text-instrument text-data-warn">
                          {`Scored on partial evidence — ${missingGold} of ${item.gold_doc_ids.length} gold documents were not indexed.`}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono text-ui tabular-nums">
                      {/* A count that can be bad takes the tone when it is. */}
                      <span className={partial ? "text-data-warn" : "text-body"}>
                        {hits}/{item.gold_doc_ids.length}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right font-mono text-ui tabular-nums text-body">
                      {item.result_count}
                    </td>
                    {metricNames.map((name) => (
                      <td
                        key={name}
                        className="py-3 pr-3 text-right font-mono text-ui tabular-nums text-primary"
                      >
                        {item.failed || unscored ? (
                          <span className="text-muted">—</span>
                        ) : (
                          formatMetric(item.metrics[`${name}@${headlineK}`])
                        )}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-right">
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
    </Panel>
  );
}

/** Catalog labels read `Recall@k`; the column pins the run's actual cutoff. */
function metricColumnHeader(name: string, label: string | undefined, k: number): string {
  const base = (label ?? name).replace(/@k$/i, "");
  return `${base}@${k}`;
}

function TraceLink({ item }: { item: EvalRunItem }) {
  // Without a chunk the trace opens unfocused: no rank path, no ingestion
  // band. The top-ranked result is the one this row's metrics are about.
  const focusChunk = item.retrieved.find((chunk) => chunk.chunk_id)?.chunk_id;
  const chunkParam = focusChunk ? `?chunk=${encodeURIComponent(focusChunk)}` : "";
  const href = item.query_event_id
    ? `/traces/queries/${item.query_event_id}${chunkParam}`
    : item.pipeline_run_id
      ? `/traces/runs/${item.pipeline_run_id}`
      : null;
  if (!href) {
    return <span className="text-ui text-meta">—</span>;
  }
  return (
    <ButtonLink href={href} variant="ghost">
      Open
    </ButtonLink>
  );
}
