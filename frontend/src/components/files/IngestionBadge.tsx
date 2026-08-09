"use client";

import { Ban, Check, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { FileNode } from "@/lib/types";

type IngestionBadgeProps = {
  node: FileNode;
  onRetry: (node: FileNode) => void;
};

function warningCountLabel(count: number): string {
  return `${count} ${count === 1 ? "warning" : "warnings"}`;
}

/**
 * The discreet per-file ingestion state: green check (indexed), amber refresh
 * (indexed by an older pipeline version — click re-ingests), spinner
 * (queued/running), a grey ban (a type this collection's pipeline does not
 * read — no retry, since a rerun reaches the same answer), or a red X
 * (failed / never eligible) that retries on click. Hover explains; folders
 * render nothing.
 */
export function IngestionBadge({ node, onRetry }: IngestionBadgeProps) {
  if (node.kind !== "file") {
    return null;
  }
  const ingestion = node.ingestion;

  if (ingestion?.status === "ready" && ingestion.stale) {
    return (
      <Tooltip content="Ingested with an older version of the ingestion pipeline. Click to re-ingest.">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry(node);
          }}
          aria-label="Out of date: ingested with an older version of the ingestion pipeline. Re-ingest."
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full bg-data-warn/15 text-data-warn",
            "transition hover:bg-data-warn/30 focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </button>
      </Tooltip>
    );
  }

  if (ingestion?.status === "ready" && ingestion.warnings.length > 0) {
    const warningLabel = warningCountLabel(ingestion.warnings.length);
    return (
      <Tooltip content={`Ingested with ${warningLabel} — ${ingestion.num_chunks} chunks`}>
        <span
          tabIndex={0}
          aria-label={`Ingested with ${warningLabel}, ${ingestion.num_chunks} chunks`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-data-warn/15 text-data-warn"
        >
          <TriangleAlert className="h-3 w-3" aria-hidden />
        </span>
      </Tooltip>
    );
  }

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

  // Nothing went wrong and a rerun changes nothing, so this state neither
  // alarms nor offers a retry — it names the pipeline that declined the file.
  if (ingestion?.status === "unsupported") {
    const explanation = ingestion.error_message ?? "This pipeline does not read this file type.";
    return (
      <Tooltip content={explanation}>
        <span
          tabIndex={0}
          aria-label={`Not indexed: ${explanation}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-strong text-meta"
        >
          <Ban className="h-3 w-3" aria-hidden />
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
