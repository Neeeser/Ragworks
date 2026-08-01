"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import {
  GraphDocPanel,
  type GraphNeighbor,
} from "@/components/collections/detail/visualize/GraphDocPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchDocuments, fetchInsightGraph } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

import type { InsightDocPoint } from "@/lib/types";

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

/** The document graph plus its similarity-threshold control and node inspector. */
export function GraphView({ collectionId, token, dataVersion }: GraphViewProps) {
  const {
    data: graph,
    loading,
    error,
  } = useApiQuery(
    useCallback(() => fetchInsightGraph(token, collectionId), [collectionId, token]),
    [collectionId, token, dataVersion],
  );
  // The document records behind the nodes: status, token counts, and the
  // ingestion run the inspector's trace button routes to. Loads beside the
  // graph; the panel simply shows less until it lands.
  const { data: documentRecords } = useApiQuery(
    useCallback(() => fetchDocuments(token, collectionId), [collectionId, token]),
    [collectionId, token, dataVersion],
  );
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  const handleSelectDocument = useCallback((point: InsightDocPoint | null) => {
    setSelectedDocumentId(point ? point.document_id : null);
  }, []);

  const selectedPoint = useMemo(
    () => graph?.documents.find((doc) => doc.document_id === selectedDocumentId) ?? null,
    [graph, selectedDocumentId],
  );
  const selectedRecord = useMemo(
    () => documentRecords?.find((doc) => doc.id === selectedDocumentId) ?? null,
    [documentRecords, selectedDocumentId],
  );
  // Every tie the selected document has, regardless of the display threshold —
  // the panel is where the sub-threshold long tail stays reachable.
  const neighbors = useMemo<GraphNeighbor[]>(() => {
    if (!graph || !selectedDocumentId) {
      return [];
    }
    const pointOf = new Map(graph.documents.map((doc) => [doc.document_id, doc]));
    return graph.edges
      .filter(
        (edge) =>
          edge.source_document_id === selectedDocumentId ||
          edge.target_document_id === selectedDocumentId,
      )
      .flatMap((edge) => {
        const otherId =
          edge.source_document_id === selectedDocumentId
            ? edge.target_document_id
            : edge.source_document_id;
        const point = pointOf.get(otherId);
        return point
          ? [{ point, similarity: edge.similarity, collisionCount: edge.collision_count }]
          : [];
      })
      .sort((a, b) => b.similarity - a.similarity);
  }, [graph, selectedDocumentId]);

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
      <div className="flex min-h-0 flex-1">
        <section aria-label="Document similarity graph" className="relative min-w-0 flex-1">
          {graph.documents.length < 2 ? (
            <div className="flex h-full items-center justify-center p-8">
              <p className="max-w-[66ch] text-center text-ui text-muted">
                The graph needs at least two documents.
              </p>
            </div>
          ) : (
            <GraphCanvas
              documents={graph.documents}
              edges={graph.edges}
              threshold={threshold}
              selectedDocumentId={selectedDocumentId}
              onSelectDocument={handleSelectDocument}
            />
          )}
        </section>
        {selectedPoint ? (
          <GraphDocPanel
            point={selectedPoint}
            document={selectedRecord}
            neighbors={neighbors}
            onSelectNeighbor={handleSelectDocument}
            onClose={() => setSelectedDocumentId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
