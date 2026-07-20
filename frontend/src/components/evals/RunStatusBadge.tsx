"use client";

import { runStatusTone } from "@/components/evals/lib/metrics";
import { cn } from "@/lib/utils";

import type { EvalRunStatus } from "@/lib/types";

export function RunStatusBadge({ status }: { status: EvalRunStatus }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", runStatusTone(status))} />
      {status}
    </span>
  );
}
