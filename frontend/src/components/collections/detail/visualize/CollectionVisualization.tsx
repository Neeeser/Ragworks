"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { ChunkDetailPanel } from "@/components/collections/detail/visualize/ChunkDetailPanel";
import { ChunkPreviewOverlay } from "@/components/collections/detail/visualize/ChunkPreviewOverlay";
import {
  ProjectionToolbar,
  ProjectionToolbarSkeleton,
} from "@/components/collections/detail/visualize/ProjectionToolbar";
import { PageBody } from "@/components/ui/app-shell";
import { Panel } from "@/components/ui/panel";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Skeleton } from "@/components/ui/skeleton";
import { computeCollectionUmap, fetchChunkDetail, fetchCollectionUmap } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";

import type { ChunkDetail, UmapPoint, UmapVisualization } from "@/lib/types";

const UmapCanvas = dynamic(
  () =>
    import("@/components/collections/detail/visualize/UmapCanvas").then((mod) => mod.UmapCanvas),
  {
    ssr: false,
    // The plot's final geometry, so the canvas landing moves nothing.
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
  },
);

type CollectionVisualizationProps = {
  collectionId: string;
  token: string;
};

/**
 * The collection's embeddings as a plane: every indexed chunk placed by UMAP,
 * with the selected point's chunk docked beside it.
 *
 * The whole page is one card — toolbar, plot, and inspector share a single
 * elevated surface separated by hairlines, because they are one instrument and
 * not three stacked ones. The plot is the only element here that uses every
 * pixel it is given, so nothing else reserves height it does not need: the
 * inspector exists only while a point is selected.
 */
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

  const loadVisualization = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchCollectionUmap(token, collectionId);
      setVisualization(data);
    } catch (error) {
      setVisualization(null);
      // A 404 means no projection has been computed yet — that is the empty
      // state (which already says so), not a failure to report in red.
      if (!(error instanceof ApiError && error.status === 404)) {
        setMessage(getErrorMessage(error, "Unable to load UMAP."));
      }
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

  const clearSelection = useCallback(() => {
    setSelectedPoint(null);
    setChunkDetail(null);
    setChunkError(null);
  }, []);

  return (
    <PageBody className="flex flex-col">
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading ? (
          <ProjectionToolbarSkeleton />
        ) : (
          <ProjectionToolbar
            projection={visualization?.projection ?? null}
            computing={computing}
            onRefresh={loadVisualization}
            onCompute={handleCompute}
          />
        )}

        {/* The pulse is licensed only while the projection is actually being
            fitted, and unmounts the moment it finishes. */}
        {computing ? <PulseWire label="Computing projection" className="w-full shrink-0" /> : null}

        {message ? (
          <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-data-neg">
            {message}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <section aria-label="UMAP projection" className="relative min-w-0 flex-1">
            {loading ? (
              <Skeleton className="h-full w-full rounded-none" />
            ) : visualization ? (
              <UmapCanvas
                key={projectionId ?? "empty"}
                points={visualization.points}
                selectedPointId={selectedPoint?.id}
                selectedPoint={selectedPoint}
                /* c8 ignore next -- selection is exercised through the dynamic preview in tests */
                onSelectPoint={handleSelectPoint}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <p className="max-w-[66ch] text-center text-ui text-muted">
                  No projection stored. Computing one places every indexed chunk on a plane by
                  embedding similarity.
                </p>
              </div>
            )}
          </section>

          <ChunkDetailPanel
            detail={chunkDetail}
            loading={chunkLoading}
            selectedPoint={selectedPoint}
            errorMessage={chunkError}
            onClose={clearSelection}
            onExpand={chunkDetail ? () => setPreviewOpen(true) : undefined}
          />
        </div>
      </Panel>

      <ChunkPreviewOverlay
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        detail={chunkDetail}
      />
    </PageBody>
  );
}
