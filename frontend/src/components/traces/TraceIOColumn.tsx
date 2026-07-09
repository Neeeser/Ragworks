"use client";

import { containsChunkId } from "@/components/traces/trace-payload-utils";
import { TracePayloadBlock } from "@/components/traces/TracePayloadBlock";
import { TraceSummaryBlock } from "@/components/traces/TraceSummaryBlock";
import { Button } from "@/components/ui/button";

import type { PipelineNodeIOTrace, PipelineNodeSummaryValue } from "@/lib/types";

type Tone = "cyan" | "violet";

const TONE_CLASSES: Record<Tone, { container: string; title: string; toggle: string }> = {
  cyan: {
    container: "rounded-3xl border border-cyan-400/30 bg-cyan-500/10 p-4",
    title: "text-cyan-200",
    toggle: "text-cyan-100",
  },
  violet: {
    container: "rounded-3xl border border-violet-400/30 bg-violet-500/10 p-4",
    title: "text-violet-200",
    toggle: "text-violet-100",
  },
};

type TraceIOColumnProps = {
  title: string;
  tone: Tone;
  summaryItems: PipelineNodeSummaryValue[];
  ioRecords: PipelineNodeIOTrace[] | undefined;
  highlightChunkId?: string | null;
  showPayloads: boolean;
  onTogglePayloads: () => void;
  emptySummaryLabel: string;
  emptyIoLabel: string;
};

/** Renders one side (Inputs or Outputs) of the active node's trace: the primary
 * summary values, plus an optional expandable section with the full IO payloads. */
export function TraceIOColumn({
  title,
  tone,
  summaryItems,
  ioRecords,
  highlightChunkId,
  showPayloads,
  onTogglePayloads,
  emptySummaryLabel,
  emptyIoLabel,
}: TraceIOColumnProps) {
  const classes = TONE_CLASSES[tone];

  return (
    <div className={classes.container}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs uppercase tracking-[0.35em] ${classes.title}`}>{title}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePayloads}
          className={`text-[10px] uppercase tracking-[0.3em] ${classes.toggle}`}
        >
          {showPayloads ? "Hide full payloads" : "Show full payloads"}
        </Button>
      </div>
      <div className="mt-3 space-y-3">
        {summaryItems.length ? (
          summaryItems.map((item, index) => (
            <TraceSummaryBlock
              key={`${item.label}-${index}`}
              item={item}
              highlight={
                Boolean(highlightChunkId) && containsChunkId(item.value, highlightChunkId ?? "")
              }
              highlightChunkId={highlightChunkId}
            />
          ))
        ) : (
          <p className="text-xs text-slate-400">{emptySummaryLabel}</p>
        )}
      </div>
      {showPayloads && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">Full payloads</p>
          <div className="mt-3 space-y-3">
            {ioRecords?.length ? (
              ioRecords.map((record) => (
                <div key={`${record.id}-${record.port}`} className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">
                    {record.port}
                  </p>
                  <TracePayloadBlock
                    payload={record.payload}
                    highlight={
                      Boolean(highlightChunkId) &&
                      containsChunkId(record.payload, highlightChunkId ?? "")
                    }
                    highlightChunkId={highlightChunkId}
                  />
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400">{emptyIoLabel}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
