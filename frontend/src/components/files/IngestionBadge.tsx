"use client";

import { Check, Loader2, X } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { FileNode } from "@/lib/types";

type IngestionBadgeProps = {
  node: FileNode;
  onRetry: (node: FileNode) => void;
};

/**
 * The discreet per-file ingestion state: green check (indexed), spinner
 * (queued/running), or a red X (failed / never eligible) that retries on
 * click. Hover explains; folders render nothing.
 */
export function IngestionBadge({ node, onRetry }: IngestionBadgeProps) {
  if (node.kind !== "file") {
    return null;
  }
  const ingestion = node.ingestion;

  if (ingestion?.status === "ready") {
    return (
      <Tooltip content={`Ingested — ${ingestion.num_chunks} chunks`}>
        <span
          aria-label={`Ingested, ${ingestion.num_chunks} chunks`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-data-pos/15 text-data-pos"
        >
          <Check className="h-3 w-3" aria-hidden />
        </span>
      </Tooltip>
    );
  }

  if (ingestion?.status === "pending" || ingestion?.status === "processing") {
    return (
      <Tooltip content={ingestion.status === "pending" ? "Queued for ingestion" : "Ingesting…"}>
        <span
          aria-label="Ingestion in progress"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-strong text-accent-cyan"
        >
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      </Tooltip>
    );
  }

  const reason =
    ingestion?.status === "failed"
      ? (ingestion.error_message ?? "Ingestion failed.")
      : "Not supported by your ingestion pipeline.";

  return (
    <Tooltip content={`${reason} Click to retry.`}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRetry(node);
        }}
        aria-label={`Not ingested: ${reason} Retry ingestion.`}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full bg-data-neg/15 text-data-neg",
          "transition hover:bg-data-neg/30 focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </Tooltip>
  );
}
