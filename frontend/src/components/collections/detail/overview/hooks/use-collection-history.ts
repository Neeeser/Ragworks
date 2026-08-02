"use client";

import { useCallback, useMemo, useState } from "react";

import { SERIES_COLORS } from "@/components/ui/trend-chart";
import { fetchCollectionStatsHistory } from "@/lib/api";
import { UNATTRIBUTED_TOOL_KEY } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

import type { ChartBrushSpan, ChartMarker, TrendSeriesColor } from "@/components/ui/trend-chart";
import type { CollectionStatsHistory, ToolLatencySeries } from "@/lib/types";

/** Fallback width so an empty response still labels an axis rather than dividing by zero. */
const FALLBACK_BUCKET_SECONDS = 3600;

/**
 * Assign a colour per retrieval series, in the order the server lists them.
 *
 * The unattributed remainder gets the neutral slot: it is an absence of
 * attribution, not another tool, and colouring it as a peer would imply it
 * names something.
 */
function colorTools(tools: ToolLatencySeries[]): Map<string, TrendSeriesColor> {
  const colors = new Map<string, TrendSeriesColor>();
  let slot = 0;
  for (const tool of tools) {
    if (tool.key === UNATTRIBUTED_TOOL_KEY) {
      colors.set(tool.key, "neutral");
      continue;
    }
    colors.set(tool.key, SERIES_COLORS[slot % SERIES_COLORS.length]);
    slot += 1;
  }
  return colors;
}

function markersFor(
  history: CollectionStatsHistory | null,
  role: "ingest" | "tool",
  colors: Map<string, TrendSeriesColor>,
): ChartMarker[] {
  return (history?.markers ?? [])
    .filter((marker) => marker.role === role)
    .map((marker, index) => ({
      id: `${marker.key}-${marker.kind}-${marker.at}-${index}`,
      at: marker.at,
      label: marker.label,
      color: colors.get(marker.key) ?? "neutral",
    }));
}

/**
 * The Overview's shared chart domain.
 *
 * One fetch feeds every chart, so growth and latency always describe the same
 * span — which is the whole point of marking pipeline changes on both. Brushing
 * any chart narrows the domain for all of them.
 */
export function useCollectionHistory(token: string, collectionId: string) {
  const [zoom, setZoom] = useState<ChartBrushSpan | null>(null);

  const query = useApiQuery(
    () => fetchCollectionStatsHistory(token, collectionId, zoom),
    [token, collectionId, zoom],
  );

  const history = query.data;
  const points = useMemo(() => history?.points ?? [], [history]);
  const buckets = useMemo(() => points.map((point) => point.bucket_start), [points]);
  const bucketSeconds = history?.bucket_seconds ?? FALLBACK_BUCKET_SECONDS;
  const tools = useMemo(() => history?.tools ?? [], [history]);
  const ingestionEvents = useMemo(() => history?.ingestion_events ?? [], [history]);
  const queryEvents = useMemo(() => history?.query_events ?? [], [history]);
  const toolColors = useMemo(() => colorTools(tools), [tools]);

  const ingestMarkers = useMemo(
    () => markersFor(history ?? null, "ingest", toolColors),
    [history, toolColors],
  );
  const toolMarkers = useMemo(
    () => markersFor(history ?? null, "tool", toolColors),
    [history, toolColors],
  );

  const zoomOut = useCallback(() => setZoom(null), []);

  return {
    history: history ?? null,
    points,
    buckets,
    bucketSeconds,
    tools,
    toolColors,
    ingestionEvents,
    queryEvents,
    eventsSampled: history?.events_sampled ?? false,
    ingestMarkers,
    toolMarkers,
    zoom,
    setZoom,
    zoomOut,
    loading: query.loading,
    error: query.error,
  };
}
