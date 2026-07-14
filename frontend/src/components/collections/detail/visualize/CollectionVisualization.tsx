"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ChunkDetailPanel } from "@/components/collections/detail/visualize/ChunkDetailPanel";
import { ChunkPreviewOverlay } from "@/components/collections/detail/visualize/ChunkPreviewOverlay";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { computeCollectionUmap, fetchChunkDetail, fetchCollectionUmap } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { timeAgo } from "@/lib/utils";

import type { ChunkDetail, UmapPoint, UmapVisualization } from "@/lib/types";

const UmapCanvas = dynamic(
  () =>
    import("@/components/collections/detail/visualize/UmapCanvas").then((mod) => mod.UmapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader className="h-6 w-6" />
      </div>
    ),
  },
);

type CollectionVisualizationProps = {
  collectionId: string;
  token: string;
};

export function CollectionVisualization({ collectionId, token }: CollectionVisualizationProps) {
  const [visualization, setVisualization] = useState<UmapVisualization | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<UmapPoint | null>(null);
  const [chunkDetail, setChunkDetail] = useState<ChunkDetail | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const projectionId = visualization?.projection.id ?? null;

  const projectionSummary = useMemo(() => {
    if (!visualization) return null;
    const projection = visualization.projection;
    return {
      computedAgo: timeAgo(projection.created_at),
      embeddingModel: projection.embedding_model,
      pointCount: projection.point_count,
    };
  }, [visualization]);

  const loadVisualization = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchCollectionUmap(token, collectionId);
      setVisualization(data);
    } catch (error) {
      const detail = getErrorMessage(error, "Unable to load UMAP.");
      setVisualization(null);
      setMessage(detail);
    } finally {
      setLoading(false);
    }
  }, [collectionId, token]);

  useEffect(() => {
    loadVisualization();
  }, [loadVisualization]);

  useEffect(() => {
    setSelectedPoint(null);
    setChunkDetail(null);
    setChunkError(null);
    setPreviewOpen(false);
  }, [projectionId]);

  const handleCompute = useCallback(async () => {
    setComputing(true);
    setMessage(null);
    try {
      const data = await computeCollectionUmap(token, collectionId);
      setVisualization(data);
    } catch (error) {
      const detail = getErrorMessage(error, "Unable to compute UMAP.");
      setMessage(detail);
    } finally {
      setComputing(false);
    }
  }, [collectionId, token]);

  const handleSelectPoint = useCallback(
    async (point: UmapPoint) => {
      setSelectedPoint(point);
      setChunkLoading(true);
      setChunkDetail(null);
      setChunkError(null);
      try {
        const detail = await fetchChunkDetail(token, point.chunk_id);
        setChunkDetail(detail);
      } catch (error) {
        const detail = getErrorMessage(error, "Unable to load chunk details.");
        setChunkError(detail);
      } finally {
        setChunkLoading(false);
      }
    },
    [token],
  );

  if (loading) {
    return (
      <GlassCard className="flex items-center justify-center rounded-3xl border border-hairline p-10">
        <Loader className="h-6 w-6" />
      </GlassCard>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-240px)] flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          UMAP projection
        </p>
        {projectionSummary && (
          <p className="flex flex-wrap items-center gap-x-4 font-mono text-[11px] text-meta">
            <span>
              <span className="text-primary">{projectionSummary.pointCount.toLocaleString()}</span>{" "}
              points
            </span>
            <span className="text-faint" aria-hidden>
              /
            </span>
            <span>{projectionSummary.embeddingModel}</span>
            <span className="text-faint" aria-hidden>
              /
            </span>
            <span>computed {projectionSummary.computedAgo}</span>
          </p>
        )}
        <div className="ml-auto flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadVisualization}>
            Refresh
          </Button>
          <Button size="sm" onClick={handleCompute} loading={computing}>
            {projectionSummary ? "Recompute" : "Compute UMAP"}
          </Button>
        </div>
      </div>
      {message && (
        <div className="rounded-2xl border border-data-neg/30 bg-data-neg/10 p-3 text-sm text-data-neg">
          {message}
        </div>
      )}

      {visualization ? (
        <div className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <GlassCard className="relative h-full min-h-[480px] overflow-hidden rounded-3xl border border-hairline">
            <UmapCanvas
              key={projectionId ?? "empty"}
              points={visualization.points}
              selectedPointId={selectedPoint?.id}
              selectedPoint={selectedPoint}
              /* c8 ignore next -- selection is exercised through the dynamic preview in tests */
              onSelectPoint={handleSelectPoint}
            />
          </GlassCard>
          <ChunkDetailPanel
            detail={chunkDetail}
            loading={chunkLoading}
            selectedPoint={selectedPoint}
            errorMessage={chunkError}
            onExpand={chunkDetail ? () => setPreviewOpen(true) : undefined}
          />
        </div>
      ) : (
        <GlassCard className="flex flex-1 items-center justify-center rounded-3xl border border-hairline p-10">
          <p className="max-w-sm text-center text-sm text-muted text-balance">
            Upload documents, then compute a projection to plot their embeddings.
          </p>
        </GlassCard>
      )}
      <ChunkPreviewOverlay
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        detail={chunkDetail}
      />
    </div>
  );
}
