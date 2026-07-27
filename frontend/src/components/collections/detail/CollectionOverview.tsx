"use client";

import { useMemo } from "react";

import { DiagnosticsCard } from "@/components/collections/detail/overview/DiagnosticsCard";
import { useCollectionHistory } from "@/components/collections/detail/overview/hooks/use-collection-history";
import { IndexesCard } from "@/components/collections/detail/overview/IndexesCard";
import { IngestionLatencyCard } from "@/components/collections/detail/overview/IngestionLatencyCard";
import { OverviewToolbar } from "@/components/collections/detail/overview/OverviewToolbar";
import { PipelinesCard } from "@/components/collections/detail/overview/PipelinesCard";
import { RetrievalLatencyCard } from "@/components/collections/detail/overview/RetrievalLatencyCard";
import { StatTrendCard } from "@/components/collections/detail/overview/StatTrendCard";
import { ToolsPanel } from "@/components/collections/detail/overview/ToolsPanel";
import { McpAccessCard } from "@/components/mcp/McpAccessCard";
import { PageBody } from "@/components/ui/app-shell";
import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";
import { PanelGrid } from "@/components/ui/panel";
import { listCollectionTools } from "@/lib/api";
import { formatLatency, formatTimeAgoCompact } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";

type CollectionOverviewProps = {
  collection: Collection;
  stats: CollectionStats | null;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
};

export function CollectionOverview({
  collection,
  stats,
  ingestionPipelines,
  retrievalPipelines,
  token,
  onCollectionUpdated,
}: CollectionOverviewProps) {
  const history = useCollectionHistory(token, collection.id);
  const {
    points,
    buckets,
    bucketSeconds,
    tools: toolSeries,
    toolColors,
    ingestMarkers,
    toolMarkers,
    zoom,
    setZoom,
    zoomOut,
  } = history;

  // The chart's `toolSeries` describes traffic per bound tool; the bindings
  // themselves are a separate resource the Tools panel both lists and edits.
  const toolsQuery = useApiQuery(
    () => listCollectionTools(token, collection.id),
    [token, collection.id],
  );
  const tools = useMemo(() => toolsQuery.data?.tools ?? [], [toolsQuery.data]);

  return (
    <PageBody className="space-y-3">
      {/* No title block: the breadcrumb owns the collection's name. The numbers a
          user opens this page for lead instead. */}
      <KpiStrip>
        <KpiCell label="Documents" value={stats?.document_count ?? null} />
        <KpiCell label="Chunks" value={stats?.chunk_count ?? null} />
        <KpiCell
          label="Avg query latency"
          value={stats?.average_latency_ms == null ? null : formatLatency(stats.average_latency_ms)}
        />
        <KpiCell
          label="Last queried"
          value={stats?.last_used_at ? formatTimeAgoCompact(stats.last_used_at) : null}
        />
        <KpiCell label="Range" value={zoom ? "Zoomed" : "All time"} />
      </KpiStrip>

      {collection.description?.trim() ? (
        <p className="max-w-[66ch] text-ui text-body">{collection.description}</p>
      ) : null}

      <OverviewToolbar collectionId={collection.id} zoomed={Boolean(zoom)} onResetZoom={zoomOut} />

      {history.error && <p className="text-ui text-data-neg">{history.error}</p>}

      <PanelGrid columns={2}>
        <StatTrendCard
          label="Documents"
          buckets={buckets}
          bucketSeconds={bucketSeconds}
          values={points.map((point) => point.document_total)}
          markers={ingestMarkers}
          onBrush={setZoom}
          onResetBrush={zoomOut}
        />
        <StatTrendCard
          label="Chunks"
          buckets={buckets}
          bucketSeconds={bucketSeconds}
          values={points.map((point) => point.chunk_total)}
          markers={ingestMarkers}
          onBrush={setZoom}
          onResetBrush={zoomOut}
        />
      </PanelGrid>

      <IngestionLatencyCard
        points={points}
        summary={history.history?.ingestion_summary ?? { count: 0 }}
        buckets={buckets}
        bucketSeconds={bucketSeconds}
        markers={ingestMarkers}
        onBrush={setZoom}
        onResetBrush={zoomOut}
      />

      <RetrievalLatencyCard
        points={points}
        tools={toolSeries}
        toolColors={toolColors}
        buckets={buckets}
        bucketSeconds={bucketSeconds}
        markers={toolMarkers}
        onBrush={setZoom}
        onResetBrush={zoomOut}
      />

      <DiagnosticsCard collectionId={collection.id} token={token} />

      <PipelinesCard
        collection={collection}
        ingestionPipelines={ingestionPipelines}
        retrievalPipelines={retrievalPipelines}
        token={token}
        onCollectionUpdated={onCollectionUpdated}
      />

      <IndexesCard collection={collection} token={token} />

      <ToolsPanel
        collection={collection}
        toolPipelines={retrievalPipelines}
        tools={tools}
        loading={toolsQuery.loading}
        token={token}
        onToolsChanged={toolsQuery.reload}
        onCollectionUpdated={onCollectionUpdated}
      />

      <McpAccessCard collection={collection} token={token} />
    </PageBody>
  );
}
