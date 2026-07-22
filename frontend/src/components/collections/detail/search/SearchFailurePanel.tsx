"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { severityStyle } from "@/lib/diagnostics-severity";
import { cn } from "@/lib/utils";

import type { RetrievalFailureDetail } from "@/lib/types";

interface SearchFailurePanelProps {
  /** Structured detail when the failure was a pipeline error, else null. */
  failure: RetrievalFailureDetail | null;
  /** Plain message fallback (non-structured errors). */
  message: string;
}

/**
 * Search error display. For a structured retrieval failure it names the failed
 * node and links to the run trace; otherwise it renders the plain message in
 * the same error-box styling.
 */
export function SearchFailurePanel({ failure, message }: SearchFailurePanelProps) {
  const router = useRouter();
  const style = severityStyle("error");

  if (!failure) {
    return (
      <div className={cn("mt-4 rounded-2xl border p-3 text-sm", style.boxClass)}>{message}</div>
    );
  }

  return (
    <div className={cn("mt-4 rounded-2xl border p-4 text-sm", style.boxClass)}>
      <p className="font-medium">{failure.message}</p>
      {failure.failed_node && (
        <p className="mt-1 text-xs opacity-90">
          Failed at <span className="font-semibold">{failure.failed_node.node_name}</span> (
          {failure.failed_node.node_type})
        </p>
      )}
      {failure.pipeline_run_id && (
        <button
          type="button"
          onClick={() => router.push(`/traces/runs/${failure.pipeline_run_id}`)}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-data-neg/40 px-3 py-1.5 text-xs font-medium transition hover:bg-data-neg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          View trace
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
