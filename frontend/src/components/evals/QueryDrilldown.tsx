"use client";

import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";

import { bestChunkFor, goldDocJourneys } from "@/components/evals/lib/journey";
import { formatMetric } from "@/components/evals/lib/metrics";
import { MediaThumbnail } from "@/components/ui/asset-image";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Tooltip } from "@/components/ui/tooltip";
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
 *
 * The region wears `bg-surface` — it is the inspecting pane inside the queries
 * card, so fill plus seam keeps it reading as a different room.
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
    <div className="space-y-4 border-t border-hairline bg-surface px-3 py-3">
      <section>
        <InstrumentLabel className="block">Expected documents</InstrumentLabel>
        <ul className="mt-2 space-y-2">
          {journeys.map((journey) => (
            <li key={journey.documentId}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <DocumentLink
                  item={item}
                  documentId={journey.documentId}
                  title={documentTitles[journey.documentId]}
                />
                {journey.finalRank !== null ? (
                  <span className="text-instrument text-data-pos">
                    retrieved at rank {journey.finalRank}
                  </span>
                ) : (
                  <span className="text-instrument text-data-neg">
                    not retrieved{journey.droppedAt ? ` — lost at ${journey.droppedAt}` : ""}
                  </span>
                )}
              </div>
              <StagePath journey={journey} />
            </li>
          ))}
          {journeys.length === 0 && (
            <li className="text-ui text-muted">No relevance judgments for this query.</li>
          )}
        </ul>
      </section>

      {item.retrieved.length > 0 && (
        <section>
          <InstrumentLabel className="block">Returned results</InstrumentLabel>
          <ol className="mt-2 space-y-1.5">
            {shown.map((chunk, index) => (
              <li
                key={chunk.chunk_id ?? `${chunk.document_id}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span className="w-7 shrink-0 font-mono text-instrument tabular-nums text-meta">
                  #{index + 1}
                </span>
                {/* A square node dot, like every state marker in the console:
                    gold means this result was judged relevant. */}
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-[2px]",
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
                  <span className="text-instrument font-medium text-data-pos">gold</span>
                )}
                {typeof chunk.score === "number" && (
                  <span className="font-mono text-instrument tabular-nums text-meta">
                    {chunk.score.toFixed(4)}
                  </span>
                )}
                {/* An image result indexes under a derived `[image: …]` name,
                    so the picture is what says whether it is the right one. */}
                <MediaThumbnail
                  media={chunk.media}
                  alt={`Image result ${chunk.document_id}`}
                  className="max-h-24 basis-full"
                />
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <p className="mt-2 font-mono text-instrument tabular-nums text-meta">
              + {hidden} more results
            </p>
          )}
        </section>
      )}

      {Object.keys(item.metrics).length > 0 && (
        <section className="flex flex-wrap gap-x-4 gap-y-1.5">
          {Object.entries(item.metrics).map(([key, value]) => (
            <span key={key} className="flex items-baseline gap-1.5">
              <span className="font-mono text-instrument text-muted">{key}</span>
              <span className="font-mono text-instrument tabular-nums text-primary">
                {formatMetric(value)}
              </span>
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
    return <span className="min-w-0 truncate text-ui text-body">{label}</span>;
  }
  return (
    // Explained by a themed tooltip, never a `title` attribute.
    <Tooltip content={`Open the end-to-end trace focused on ${label}`} triggerClassName="min-w-0">
      <Link
        href={`/traces/queries/${item.query_event_id}?chunk=${encodeURIComponent(focusChunk)}`}
        className="min-w-0 truncate rounded-control text-ui text-body underline-offset-4 transition-colors duration-80 ease-standard hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        {label}
      </Link>
    </Tooltip>
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
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-instrument",
              step.present ? "bg-data-pos/12 text-body" : "bg-data-neg/12 text-body",
            )}
          >
            {step.present ? (
              <Check className="h-3 w-3 shrink-0 text-data-pos" aria-hidden />
            ) : (
              <X className="h-3 w-3 shrink-0 text-data-neg" aria-hidden />
            )}
            <span className="whitespace-nowrap">{step.label}</span>
            {step.rank !== null && (
              <span className="font-mono tabular-nums text-meta">#{step.rank}</span>
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
