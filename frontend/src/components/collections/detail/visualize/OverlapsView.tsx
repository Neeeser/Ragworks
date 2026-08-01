"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchInsightOverlaps } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type { InsightOverlap, OverlapSide } from "@/lib/types";

type OverlapsViewProps = {
  collectionId: string;
  token: string;
  dataVersion: string;
};

type SortOrder = "desc" | "asc";

const PAGE_SIZE = 50;

const SORT_OPTIONS: Array<{ id: SortOrder; label: string }> = [
  { id: "desc", label: "Most similar" },
  { id: "asc", label: "Least similar" },
];

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
 * to "which chunks will retrieval mix up". Server-paged, so a million-chunk
 * corpus costs one page at a time; the sort flips between hunting duplicates
 * (most similar first) and auditing the long tail.
 */
export function OverlapsView({ collectionId, token, dataVersion }: OverlapsViewProps) {
  const [order, setOrder] = useState<SortOrder>("desc");
  const [pairs, setPairs] = useState<InsightOverlap[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPairs(null);
    setErrorMessage(null);
    (async () => {
      try {
        const page = await fetchInsightOverlaps(token, collectionId, {
          limit: PAGE_SIZE,
          offset: 0,
          order,
        });
        if (cancelled) return;
        setPairs(page.pairs);
        setTotal(page.total);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(getErrorMessage(error, "Unable to load the overlap report."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, dataVersion, order, token]);

  const loadMore = useCallback(async () => {
    if (pairs === null) return;
    setLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchInsightOverlaps(token, collectionId, {
        limit: PAGE_SIZE,
        offset: pairs.length,
        order,
      });
      setPairs((previous) => [...(previous ?? []), ...page.pairs]);
      setTotal(page.total);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Unable to load more pairs."));
    } finally {
      setLoadingMore(false);
    }
  }, [collectionId, order, pairs, token]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-3 py-2">
        <SegmentedControl
          options={SORT_OPTIONS}
          value={order}
          onChange={setOrder}
          aria-label="Overlap sort order"
        />
        {pairs !== null ? (
          <span className="font-mono text-instrument tabular-nums text-meta">
            {pairs.length.toLocaleString()} of {total.toLocaleString()} pairs
          </span>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-data-neg">
          {errorMessage}
        </p>
      ) : null}

      {pairs === null && !errorMessage ? (
        <div className="space-y-2 p-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {pairs !== null && pairs.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <p className="max-w-[66ch] text-center text-ui text-muted">
            No cross-document overlaps in this collection.
          </p>
        </div>
      ) : null}

      {pairs !== null && pairs.length > 0 ? (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {pairs.map((pair: InsightOverlap) => (
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
          {pairs.length < total ? (
            <li className="flex justify-center p-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadMore()}
                loading={loadingMore}
              >
                Load more
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
