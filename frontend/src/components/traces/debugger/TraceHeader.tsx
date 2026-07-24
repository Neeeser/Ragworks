"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { formatDuration } from "@/components/traces/debugger/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PipelineTraceResponse } from "@/lib/types";

type TraceHeaderProps = {
  trace: PipelineTraceResponse;
  combined: boolean;
  onRefresh: () => void;
};

const runDurationMs = (trace: PipelineTraceResponse): number | null => {
  if (!trace.run.completed_at) return null;
  const ms = Date.parse(trace.run.completed_at) - Date.parse(trace.run.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

/** The debugger's top bar: the way back, what run this is, and how it ended. */
export function TraceHeader({ trace, combined, onRefresh }: TraceHeaderProps) {
  const router = useRouter();
  const failed = trace.run.status === "failed";
  const running = trace.run.status === "running";
  const duration = formatDuration(runDurationMs(trace));
  const title = combined
    ? "Document → retrieval"
    : trace.run.trigger === "ingest"
      ? "Ingestion"
      : "Retrieval";

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-3 py-2.5 sm:px-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 -ml-1.5">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back
      </Button>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-meta">
          {combined ? "End-to-end trace" : "Pipeline trace"}
        </p>
        <h1 className="truncate text-base font-semibold text-primary">{title}</h1>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        {duration && (
          <span className="font-mono text-[10px] tracking-[0.08em] text-meta">{duration}</span>
        )}
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em]",
            failed
              ? "border-data-neg/50 text-data-neg"
              : "border-hairline bg-surface-strong text-muted",
          )}
        >
          {trace.run.status}
        </span>
        {running && (
          <Button variant="ghost" size="sm" onClick={onRefresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
        )}
      </div>
    </header>
  );
}
