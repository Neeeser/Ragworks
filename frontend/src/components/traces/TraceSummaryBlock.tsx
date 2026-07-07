"use client";

import { useState } from "react";

import {
  formatPayload,
  renderScalarValue,
  resolveTextSummary,
} from "@/components/traces/trace-payload-utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PipelineNodeSummaryValue } from "@/lib/types";

type TraceSummaryBlockProps = {
  item: PipelineNodeSummaryValue;
  highlight: boolean;
};

export function TraceSummaryBlock({ item, highlight }: TraceSummaryBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const textSummary = item.kind === "text" ? resolveTextSummary(item.value) : null;
  const scalarValue = textSummary ? null : renderScalarValue(item.value, expanded);
  const showToggle =
    Boolean(textSummary?.full && textSummary.full.length > textSummary.preview.length) ||
    (scalarValue === null && item.value !== undefined);
  const embeddingStats =
    item.kind === "embedding" && item.value && typeof item.value === "object"
      ? (item.value as Record<string, unknown>)
      : null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-black/30 p-3 text-xs text-slate-200",
        highlight && "border-cyan-400/70 bg-cyan-500/10",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{item.label}</p>
        {showToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[10px] uppercase tracking-[0.3em]"
          >
            {expanded ? "Collapse" : "Expand"}
          </Button>
        )}
      </div>
      {textSummary ? (
        <div className="mt-3 space-y-2">
          <p className="whitespace-pre-wrap text-xs text-slate-100">
            {expanded && textSummary.full ? textSummary.full : textSummary.preview}
          </p>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
            length {textSummary.length}
          </p>
        </div>
      ) : scalarValue !== null ? (
        <p className="mt-3 whitespace-pre-wrap text-xs text-slate-100">{scalarValue}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {embeddingStats && (
            <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">
              {"count" in embeddingStats && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  count {embeddingStats.count as number}
                </span>
              )}
              {"dimension" in embeddingStats && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  dimension {embeddingStats.dimension as number}
                </span>
              )}
            </div>
          )}
          <pre className="max-h-56 overflow-auto rounded-xl bg-black/40 p-3 text-[11px] text-slate-100">
            {formatPayload(item.value, expanded)}
          </pre>
        </div>
      )}
    </div>
  );
}
