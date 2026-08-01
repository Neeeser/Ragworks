"use client";

import { useState } from "react";

import { GraphView } from "@/components/collections/detail/visualize/GraphView";
import { useInsightOverview } from "@/components/collections/detail/visualize/hooks/use-insight-overview";
import {
  InsightToolbar,
  InsightToolbarSkeleton,
  type InsightViewId,
} from "@/components/collections/detail/visualize/InsightToolbar";
import { MapView } from "@/components/collections/detail/visualize/MapView";
import { OverlapsView } from "@/components/collections/detail/visualize/OverlapsView";
import { PageBody } from "@/components/ui/app-shell";
import { Panel } from "@/components/ui/panel";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Skeleton } from "@/components/ui/skeleton";

type CollectionInsightsProps = {
  collectionId: string;
  token: string;
};

/**
 * The collection's chunks as one navigable space, in three views over one
 * shared snapshot: the projection map, the document-similarity graph, and the
 * cross-document overlap report.
 *
 * The snapshot maintains itself — ingestion places new chunks into the stored
 * layout in the background and a drifted layout refits itself — so the page's
 * job is to serve the current one and show honest progress while a build runs.
 * The whole page is one card: toolbar, canvas, and inspectors share a single
 * elevated surface separated by hairlines, because they are one instrument.
 */
export function CollectionInsights({ collectionId, token }: CollectionInsightsProps) {
  const { overview, loading, errorMessage, dataVersion, computing, refresh } = useInsightOverview(
    token,
    collectionId,
  );
  const [view, setView] = useState<InsightViewId>("map");

  const snapshot = overview?.snapshot ?? null;

  return (
    <PageBody className="flex flex-col">
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading || !overview ? (
          <InsightToolbarSkeleton />
        ) : (
          <InsightToolbar
            overview={overview}
            view={view}
            onViewChange={setView}
            computing={computing}
            onRefresh={() => void refresh()}
          />
        )}

        {/* The pulse is licensed only while a projection is actually being
            fitted, and unmounts the moment it finishes. */}
        {computing ? <PulseWire label="Computing insights" className="w-full shrink-0" /> : null}

        {errorMessage ? (
          <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-data-neg">
            {errorMessage}
          </p>
        ) : null}

        {loading ? (
          <Skeleton className="min-h-0 w-full flex-1 rounded-none" />
        ) : snapshot ? (
          <>
            {view === "map" ? (
              <MapView collectionId={collectionId} token={token} dataVersion={dataVersion} />
            ) : null}
            {view === "graph" ? (
              <GraphView collectionId={collectionId} token={token} dataVersion={dataVersion} />
            ) : null}
            {view === "overlaps" ? (
              <OverlapsView collectionId={collectionId} token={token} dataVersion={dataVersion} />
            ) : null}
          </>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <p className="max-w-[66ch] text-center text-ui text-muted">
              {computing
                ? "Computing the first snapshot. The map appears when it lands."
                : overview?.can_compute
                  ? "No snapshot yet. Refresh computes one."
                  : "Ingest at least three chunks to compute insights."}
            </p>
          </div>
        )}
      </Panel>
    </PageBody>
  );
}
