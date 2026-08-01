"use client";

import { useCallback } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchInsightOverlaps } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import type { InsightOverlap, OverlapSide } from "@/lib/types";

type OverlapsViewProps = {
  collectionId: string;
  token: string;
  dataVersion: string;
};

function SideCell({ side }: { side: OverlapSide }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-ui font-medium text-primary">
          {side.document_name}
        </span>
        <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
          #{side.chunk_index}
        </span>
      </p>
      <p className="mt-0.5 line-clamp-2 text-instrument text-muted">{side.text_snippet}</p>
    </div>
  );
}

/** How strongly a pair reads as retrieval-confusable. */
function similarityTone(similarity: number): string {
  if (similarity >= 0.95) return "text-data-neg";
  if (similarity >= 0.9) return "text-data-warn";
  return "text-body";
}

/**
 * Cross-document chunk pairs ranked by exact similarity — the direct answer
 * to "which chunks will retrieval mix up". The map shows the closeness; this
 * names it, with the text on both sides.
 */
export function OverlapsView({ collectionId, token, dataVersion }: OverlapsViewProps) {
  const {
    data: overlaps,
    loading,
    error,
  } = useApiQuery(
    useCallback(() => fetchInsightOverlaps(token, collectionId), [collectionId, token]),
    [collectionId, token, dataVersion],
  );

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (error || !overlaps) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-[66ch] text-center text-ui text-data-neg">
          {getErrorMessage(error, "Unable to load the overlap report.")}
        </p>
      </div>
    );
  }

  if (overlaps.pairs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-[66ch] text-center text-ui text-muted">
          No cross-document overlaps in this collection.
        </p>
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {overlaps.pairs.map((pair: InsightOverlap) => (
        <li
          key={`${pair.a.chunk_id}:${pair.b.chunk_id}`}
          className="flex items-start gap-3 border-b border-hairline px-3 py-2"
        >
          <span
            className={cn(
              "shrink-0 pt-0.5 font-mono text-ui tabular-nums",
              similarityTone(pair.similarity),
            )}
          >
            {pair.similarity.toFixed(3)}
          </span>
          <SideCell side={pair.a} />
          <span className="shrink-0 pt-0.5 text-muted" aria-hidden>
            ⇄
          </span>
          <SideCell side={pair.b} />
        </li>
      ))}
    </ul>
  );
}
