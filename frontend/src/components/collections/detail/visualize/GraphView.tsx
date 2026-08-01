"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchInsightGraph } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

const GraphCanvas = dynamic(
  () =>
    import("@/components/collections/detail/visualize/GraphCanvas").then((mod) => mod.GraphCanvas),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
  },
);

type GraphViewProps = {
  collectionId: string;
  token: string;
  dataVersion: string;
};

const DEFAULT_THRESHOLD = 0.6;

/** The document graph plus its similarity-threshold control. */
export function GraphView({ collectionId, token, dataVersion }: GraphViewProps) {
  const {
    data: graph,
    loading,
    error,
  } = useApiQuery(
    useCallback(() => fetchInsightGraph(token, collectionId), [collectionId, token]),
    [collectionId, token, dataVersion],
  );
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  if (loading) {
    return <Skeleton className="h-full w-full rounded-none" />;
  }
  if (error || !graph) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-[66ch] text-center text-ui text-data-neg">
          {getErrorMessage(error, "Unable to load the graph.")}
        </p>
      </div>
    );
  }

  const visibleCount = graph.edges.filter((edge) => edge.similarity >= threshold).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-3 py-2">
        <label htmlFor="graph-threshold" className="text-instrument font-medium text-muted">
          Edge threshold
        </label>
        <input
          id="graph-threshold"
          type="range"
          min={0.3}
          max={0.99}
          step={0.01}
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
          className="h-1 w-40 accent-[var(--accent-violet)]"
        />
        <span className="font-mono text-instrument tabular-nums text-body">
          ≥ {threshold.toFixed(2)}
        </span>
        <span className="font-mono text-instrument tabular-nums text-meta">
          {visibleCount}/{graph.edges.length} edges
        </span>
      </div>
      <section aria-label="Document similarity graph" className="relative min-h-0 flex-1">
        {graph.documents.length < 2 ? (
          <div className="flex h-full items-center justify-center p-8">
            <p className="max-w-[66ch] text-center text-ui text-muted">
              The graph needs at least two documents.
            </p>
          </div>
        ) : (
          <GraphCanvas documents={graph.documents} edges={graph.edges} threshold={threshold} />
        )}
      </section>
    </div>
  );
}
