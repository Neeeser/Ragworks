"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { isConnectionFixable } from "@/lib/types";
import type { RetrievalFailureDetail } from "@/lib/types";

interface SearchFailurePanelProps {
  /** Structured detail when the failure was a pipeline error, else null. */
  failure: RetrievalFailureDetail | null;
  /** Plain message fallback (non-structured errors). */
  message: string;
}

/**
 * Search error display. For a structured retrieval failure it names the failed
 * node and links to the run trace; otherwise it renders the plain message.
 *
 * The failure reads in place at the foot of the composer that produced it — a
 * tinted alert box would nest a second surface inside the card it sits in, so
 * the ink alone carries the severity.
 */
export function SearchFailurePanel({ failure, message }: SearchFailurePanelProps) {
  const router = useRouter();

  if (!failure) {
    return (
      <p className="mt-3 max-w-[66ch] border-t border-hairline pt-3 text-ui text-data-neg">
        {message}
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="max-w-[66ch] text-ui text-data-neg">{failure.message}</p>
      {failure.failed_node && (
        <p className="mt-1 text-instrument text-muted">
          Failed at{" "}
          <span className="font-medium text-primary">{failure.failed_node.node_name}</span>{" "}
          {/* A node type id is a literal the definition stores verbatim. */}
          <span className="font-mono text-meta">{failure.failed_node.node_type}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {failure.pipeline_run_id && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => router.push(`/traces/runs/${failure.pipeline_run_id}`)}
          >
            View trace
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
        {/* A credit balance, a rejected key, and an unreachable server are all
            fixed on the connection, not by rerunning the query — so the failure
            offers that route rather than leaving the trace as the only exit. */}
        {failure.provider_error && isConnectionFixable(failure.provider_error.code) && (
          <Button size="sm" variant="secondary" onClick={() => router.push("/settings")}>
            Manage connections
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
