"use client";

import { TraceValueView } from "@/components/traces/values/TraceValueView";
import { cn } from "@/lib/utils";

import type { PipelineNodeSummaryValue } from "@/lib/types";

type TraceSummaryBlockProps = {
  item: PipelineNodeSummaryValue;
  highlight: boolean;
  highlightChunkId?: string | null;
};

/**
 * One primary input/output value. The block owns the label + highlight frame;
 * how the value itself renders is delegated to the value-view registry, so
 * each shape (text, embedding, matches, …) gets its own polished presentation.
 */
export function TraceSummaryBlock({ item, highlight, highlightChunkId }: TraceSummaryBlockProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-black/20 p-3",
        highlight && "border-cyan-400/70 bg-cyan-500/10",
      )}
    >
      <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">{item.label}</p>
      <TraceValueView
        value={item.value}
        kind={item.kind ?? "json"}
        highlightChunkId={highlightChunkId}
      />
    </div>
  );
}
