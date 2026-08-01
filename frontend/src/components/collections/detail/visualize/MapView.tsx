"use client";

import { Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import { ChunkDetailPanel } from "@/components/collections/detail/visualize/ChunkDetailPanel";
import { ChunkPreviewOverlay } from "@/components/collections/detail/visualize/ChunkPreviewOverlay";
import { ProbeResultsPanel } from "@/components/collections/detail/visualize/ProbeResultsPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchChunkDetail, fetchInsightMap, probeInsights } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

import type { ChunkDetail, InsightPoint, InsightProbeResult } from "@/lib/types";

const InsightMapCanvas = dynamic(
  () =>
    import("@/components/collections/detail/visualize/InsightMapCanvas").then(
      (mod) => mod.InsightMapCanvas,
    ),
  {
    ssr: false,
    // The plot's final geometry, so the canvas landing moves nothing.
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
  },
);

type MapViewProps = {
  collectionId: string;
  token: string;
  /** Changes whenever the served snapshot's contents may have changed. */
  dataVersion: string;
};

/**
 * The projection map plus its inspectors: click a chunk to dock its text,
 * click a document ring to focus its spread, drop a query on the plane to see
 * what retrieval would reach for.
 */
export function MapView({ collectionId, token, dataVersion }: MapViewProps) {
  const {
    data: map,
    loading,
    error,
  } = useApiQuery(
    useCallback(() => fetchInsightMap(token, collectionId), [collectionId, token]),
    [collectionId, token, dataVersion],
  );

  const [selectedPoint, setSelectedPoint] = useState<InsightPoint | null>(null);
  const [chunkDetail, setChunkDetail] = useState<ChunkDetail | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [focusedDocumentId, setFocusedDocumentId] = useState<string | null>(null);
  const [probeQuery, setProbeQuery] = useState("");
  const [probe, setProbe] = useState<InsightProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  // Which chunk request the inspector is showing. Two selections resolve in
  // whatever order the network returns them, so a slow first click would
  // otherwise dock its chunk beside the point clicked second.
  const chunkRequestRef = useRef(0);

  const handleSelectPoint = useCallback(
    async (point: InsightPoint) => {
      const request = ++chunkRequestRef.current;
      setSelectedPoint(point);
      setChunkLoading(true);
      setChunkDetail(null);
      setChunkError(null);
      try {
        const detail = await fetchChunkDetail(token, point.chunk_id);
        if (request !== chunkRequestRef.current) return;
        setChunkDetail(detail);
      } catch (fetchError) {
        if (request !== chunkRequestRef.current) return;
        setChunkError(getErrorMessage(fetchError, "Unable to load chunk details."));
      } finally {
        if (request === chunkRequestRef.current) {
          setChunkLoading(false);
        }
      }
    },
    [token],
  );

  const clearSelection = useCallback(() => {
    setSelectedPoint(null);
    setChunkDetail(null);
    setChunkError(null);
  }, []);

  const handleSelectMatch = useCallback(
    (chunkId: string) => {
      const point = map?.points.find((candidate) => candidate.chunk_id === chunkId);
      if (point) {
        void handleSelectPoint(point);
      }
    },
    [handleSelectPoint, map],
  );

  const runProbe = useCallback(async () => {
    const query = probeQuery.trim();
    if (!query) {
      return;
    }
    setProbing(true);
    setProbeError(null);
    clearSelection();
    try {
      setProbe(await probeInsights(token, collectionId, query));
    } catch (probeFailure) {
      setProbeError(getErrorMessage(probeFailure, "Unable to place the query."));
    } finally {
      setProbing(false);
    }
  }, [clearSelection, collectionId, probeQuery, token]);

  const clearProbe = useCallback(() => {
    setProbe(null);
    setProbeError(null);
    setProbeQuery("");
  }, []);

  if (loading) {
    return <Skeleton className="h-full w-full rounded-none" />;
  }
  if (error || !map) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-[66ch] text-center text-ui text-data-neg">
          {getErrorMessage(error, "Unable to load the map.")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runProbe();
        }}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        <input
          type="text"
          value={probeQuery}
          onChange={(event) => setProbeQuery(event.target.value)}
          placeholder="Place a query on the map"
          aria-label="Probe query"
          className="h-7 min-w-0 flex-1 bg-transparent text-ui text-primary outline-none placeholder:text-faint"
        />
        {probe ? (
          <Button type="button" size="sm" variant="ghost" onClick={clearProbe}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant="secondary" loading={probing}>
          Probe
        </Button>
      </form>
      {probeError ? (
        <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-data-neg">
          {probeError}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section aria-label="Projection map" className="relative min-w-0 flex-1">
          <InsightMapCanvas
            points={map.points}
            documents={map.documents}
            clusters={map.clusters}
            selectedPointId={selectedPoint?.id}
            selectedPoint={selectedPoint}
            onSelectPoint={handleSelectPoint}
            focusedDocumentId={focusedDocumentId}
            onFocusDocument={setFocusedDocumentId}
            probe={probe}
          />
        </section>

        {selectedPoint ? (
          <ChunkDetailPanel
            detail={chunkDetail}
            loading={chunkLoading}
            selectedPoint={selectedPoint}
            errorMessage={chunkError}
            onClose={clearSelection}
            onExpand={chunkDetail ? () => setPreviewOpen(true) : undefined}
          />
        ) : probe ? (
          <ProbeResultsPanel probe={probe} onSelectMatch={handleSelectMatch} onClose={clearProbe} />
        ) : null}
      </div>

      <ChunkPreviewOverlay
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        detail={chunkDetail}
      />
    </div>
  );
}
