"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { formatDuration, runStatusLabel, runStatusTone } from "@/components/traces/debugger/format";
import { Button } from "@/components/ui/button";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { Readout } from "@/components/ui/readout";
import { StatusDot } from "@/components/ui/status-dot";

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

/**
 * The debugger's top bar: the breadcrumb path, how the run ended, and the way
 * back. No title block of its own — the crumb path names what this trace is,
 * and the run's status and duration are the live state the bar exists to carry.
 */
export function TraceHeader({ trace, combined, onRefresh }: TraceHeaderProps) {
  const router = useRouter();
  const running = trace.run.status === "running";
  const duration = formatDuration(runDurationMs(trace));
  const title = combined
    ? "Document → retrieval"
    : trace.run.trigger === "ingest"
      ? "Ingestion"
      : "Retrieval";

  return (
    <CrumbBar
      crumbs={[{ label: "Traces" }, { label: title }]}
      state={
        <>
          <StatusDot
            tone={runStatusTone(trace.run.status)}
            label={runStatusLabel(trace.run.status)}
          />
          {duration ? <Readout label="Duration">{duration}</Readout> : null}
        </>
      }
      actions={
        <>
          {running ? (
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </Button>
        </>
      }
    />
  );
}
