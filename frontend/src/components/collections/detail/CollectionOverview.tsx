"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { DiagnosticsCard } from "@/components/collections/detail/overview/DiagnosticsCard";
import { IndexesCard } from "@/components/collections/detail/overview/IndexesCard";
import { LatencyCard } from "@/components/collections/detail/overview/LatencyCard";
import { PipelinesCard } from "@/components/collections/detail/overview/PipelinesCard";
import { RangePicker } from "@/components/collections/detail/overview/RangePicker";
import { StatTrendCard } from "@/components/collections/detail/overview/StatTrendCard";
import { ToolsPanel } from "@/components/collections/detail/overview/ToolsPanel";
import { McpAccessCard } from "@/components/mcp/McpAccessCard";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";
import { PanelGrid } from "@/components/ui/panel";
import { fetchCollectionStatsHistory, listCollectionTools } from "@/lib/api";
import { formatLatency, formatTimeAgoCompact } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection, CollectionStats, Pipeline, StatsHistoryRange } from "@/lib/types";

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
  const [copied, setCopied] = useState(false);
  const [range, setRange] = useState<StatsHistoryRange>("7d");

  const history = useApiQuery(
    () => fetchCollectionStatsHistory(token, collection.id, range),
    [token, collection.id, range],
  );

  // One tools query for the page: the Indexes card reads each binding's index
  // choice and the Tools panel curates the same bindings, so two fetches of
  // the same list would drift the moment one of them mutates.
  const toolsQuery = useApiQuery(
    () => listCollectionTools(token, collection.id),
    [token, collection.id],
  );
  const tools = useMemo(() => toolsQuery.data?.tools ?? [], [toolsQuery.data]);

  const points = useMemo(() => history.data?.points ?? [], [history.data]);
  const buckets = useMemo(() => points.map((point) => point.bucket_start), [points]);
  const granularity = history.data?.bucket ?? (range === "4h" || range === "24h" ? "hour" : "day");

  const copyId = async () => {
    await navigator.clipboard.writeText(collection.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

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
        <KpiCell label="Range" value={range.toUpperCase()} />
      </KpiStrip>

      {collection.description?.trim() ? (
        <p className="max-w-[66ch] text-ui text-body">{collection.description}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <RangePicker value={range} onChange={setRange} />
        <Button size="sm" variant="ghost" onClick={copyId}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-data-pos" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copied ? "Copied" : "Copy id"}
        </Button>
      </div>

      {history.error && <p className="text-ui text-data-neg">{history.error}</p>}

      <PanelGrid columns={2}>
        <StatTrendCard
          label="Documents"
          buckets={buckets}
          granularity={granularity}
          values={points.map((point) => point.document_total)}
        />
        <StatTrendCard
          label="Chunks"
          buckets={buckets}
          granularity={granularity}
          values={points.map((point) => point.chunk_total)}
        />
      </PanelGrid>

      <LatencyCard points={points} granularity={granularity} />

      <DiagnosticsCard collectionId={collection.id} token={token} />

      <PipelinesCard
        collection={collection}
        ingestionPipelines={ingestionPipelines}
        retrievalPipelines={retrievalPipelines}
        token={token}
        onCollectionUpdated={onCollectionUpdated}
      />

      <IndexesCard
        collection={collection}
        token={token}
        toolPipelines={retrievalPipelines}
        tools={tools}
        onToolsChanged={toolsQuery.reload}
      />

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
