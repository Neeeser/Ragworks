"use client";

import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";

import { bestChunkFor, goldDocJourneys } from "@/components/evals/lib/journey";
import { formatMetric } from "@/components/evals/lib/metrics";
import { cn } from "@/lib/utils";

import type { GoldDocJourney } from "@/components/evals/lib/journey";
import type { EvalRunItem, FunnelStage } from "@/lib/types";

interface QueryDrilldownProps {
  item: EvalRunItem;
  stages: FunnelStage[];
  documentTitles: Record<string, string>;
  maxRetrievedShown?: number;
}

const DEFAULT_RETRIEVED_SHOWN = 10;

/**
 * One evaluated query, opened: every expected (gold) document with its stage
 * path across the pipeline, and the ranked results it actually returned.
 * Documents deep-link into the end-to-end trace focused on their best chunk.
 */
export function QueryDrilldown({
  item,
  stages,
  documentTitles,
  maxRetrievedShown = DEFAULT_RETRIEVED_SHOWN,
}: QueryDrilldownProps) {
  const journeys = goldDocJourneys(stages, item);
  const gold = new Set(item.gold_doc_ids);
  const shown = item.retrieved.slice(0, maxRetrievedShown);
  const hidden = item.retrieved.length - shown.length;

  return (
    <div className="space-y-5 border-t border-hairline bg-canvas px-4 py-4">
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Expected documents
        </p>
        <ul className="mt-3 space-y-3">
          {journeys.map((journey) => (
            <li key={journey.documentId}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <DocumentLink
                  item={item}
                  documentId={journey.documentId}
                  title={documentTitles[journey.documentId]}
                />
                {journey.finalRank !== null ? (
                  <span className="font-mono text-[11px] text-data-pos">
                    retrieved at rank {journey.finalRank}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-data-neg">
                    not retrieved{journey.droppedAt ? ` — lost at ${journey.droppedAt}` : ""}
                  </span>
                )}
              </div>
              <StagePath journey={journey} />
            </li>
          ))}
          {journeys.length === 0 && (
            <li className="text-sm text-muted">No relevance judgments for this query.</li>
          )}
        </ul>
      </section>

      {item.retrieved.length > 0 && (
        <section>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            Returned results
          </p>
          <ol className="mt-3 space-y-1.5">
            {shown.map((chunk, index) => (
              <li
                key={chunk.chunk_id ?? `${chunk.document_id}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span className="w-7 shrink-0 font-mono text-[11px] text-meta">#{index + 1}</span>
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full",
                    gold.has(chunk.document_id) ? "bg-data-pos" : "bg-stage-neutral",
                  )}
                />
                <DocumentLink
                  item={item}
                  documentId={chunk.document_id}
                  chunkId={chunk.chunk_id ?? null}
                  title={documentTitles[chunk.document_id]}
                />
                {gold.has(chunk.document_id) && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-data-pos">
                    gold
                  </span>
                )}
                {typeof chunk.score === "number" && (
                  <span className="font-mono text-[11px] text-meta">{chunk.score.toFixed(4)}</span>
                )}
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <p className="mt-2 font-mono text-[11px] text-meta">+ {hidden} more results</p>
          )}
        </section>
      )}

      {Object.keys(item.metrics).length > 0 && (
        <section className="flex flex-wrap gap-x-5 gap-y-1.5">
          {Object.entries(item.metrics).map(([key, value]) => (
            <span key={key} className="font-mono text-[11px] text-muted">
              {key} <span className="text-primary">{formatMetric(value)}</span>
            </span>
          ))}
        </section>
      )}
    </div>
  );
}

/** The document's name, linking to its focused end-to-end trace when possible. */
function DocumentLink({
  item,
  documentId,
  title,
  chunkId,
}: {
  item: EvalRunItem;
  documentId: string;
  title?: string;
  chunkId?: string | null;
}) {
  const focusChunk = chunkId ?? bestChunkFor(item, documentId)?.chunkId ?? null;
  const label = title || documentId;
  if (!item.query_event_id || !focusChunk) {
    return <span className="min-w-0 truncate text-sm text-body">{label}</span>;
  }
  return (
    <Link
      href={`/traces/queries/${item.query_event_id}?chunk=${encodeURIComponent(focusChunk)}`}
      className="min-w-0 truncate text-sm text-body underline-offset-4 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-accent-violet"
      title={`Open the end-to-end trace focused on ${label}`}
    >
      {label}
    </Link>
  );
}

/** ✓/✗ pills across the run's funnel stages, mirroring the trace rank path. */
function StagePath({ journey }: { journey: GoldDocJourney }) {
  if (journey.steps.length === 0) return null;
  return (
    <div
      className="mt-1.5 flex items-center gap-1.5 overflow-x-auto"
      role="img"
      aria-label={stagePathLabel(journey)}
    >
      {journey.steps.map((step, index) => (
        <span key={step.nodeId} className="flex shrink-0 items-center gap-1.5">
          {index > 0 && <ArrowRight className="h-3 w-3 text-faint" aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
              step.present ? "border-hairline bg-surface" : "border-data-neg/30 bg-data-neg/5",
            )}
          >
            {step.present ? (
              <Check className="h-3 w-3 text-data-pos" aria-hidden />
            ) : (
              <X className="h-3 w-3 text-data-neg" aria-hidden />
            )}
            <span className="text-[11px] text-body">{step.label}</span>
            {step.rank !== null && (
              <span className="font-mono text-[10px] text-accent-cyan">#{step.rank}</span>
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

function stagePathLabel(journey: GoldDocJourney): string {
  const parts = journey.steps.map(
    (step) => `${step.label}: ${step.present ? "present" : "absent"}`,
  );
  return `Stage path for ${journey.documentId} — ${parts.join(", ")}`;
}
