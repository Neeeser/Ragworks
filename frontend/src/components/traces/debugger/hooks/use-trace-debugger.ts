"use client";

import { useMemo, useState } from "react";

import { buildTraceGraph } from "@/components/traces/trace-graph";
import {
  fetchDocumentFocusedTrace,
  fetchDocumentTrace,
  fetchPipelineNodes,
  fetchPipelineRunTrace,
  fetchQueryEventEndToEndTrace,
  fetchQueryEventTrace,
} from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { TraceGraph } from "@/components/traces/trace-graph";
import type { PipelineTraceResponse, TraceFocusedItem } from "@/lib/types";

/** What the debugger page was opened on — mirrors the three trace endpoints. */
export type TraceSource = {
  kind: "query" | "document" | "run";
  id: string;
  chunkId: string | null;
};

type LoadedTrace = {
  trace: PipelineTraceResponse;
  origin: PipelineTraceResponse | null;
  focusedItem: TraceFocusedItem | null;
};

type FocusState = {
  sourceKey: string;
  itemId: string | null;
};

export type UseTraceDebuggerResult = {
  graph: TraceGraph | null;
  trace: PipelineTraceResponse | null;
  origin: PipelineTraceResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  focusedItemId: string | null;
  /** Live-resolved chunk behind the focused id — text and document context. */
  focusedItem: TraceFocusedItem | null;
  focusItem: (itemId: string) => void;
  clearFocus: () => void;
  /** Non-blocking: node specs enrich the graph but the trace renders without them. */
  specsNotice: string | null;
};

async function loadTrace(token: string, source: TraceSource): Promise<LoadedTrace> {
  if (source.kind === "query") {
    if (source.chunkId) {
      // Tracing a specific chunk joins retrieval with the ingestion run that
      // produced it; absent origin data degrades to the plain retrieval trace.
      const payload = await fetchQueryEventEndToEndTrace(token, source.id, source.chunkId);
      return {
        trace: payload.retrieval,
        origin: payload.origin?.trace ?? null,
        focusedItem: payload.focused_item ?? null,
      };
    }
    return { trace: await fetchQueryEventTrace(token, source.id), origin: null, focusedItem: null };
  }
  if (source.kind === "document") {
    if (source.chunkId) {
      const payload = await fetchDocumentFocusedTrace(token, source.id, source.chunkId);
      return { trace: payload.trace, origin: null, focusedItem: payload.focused_item ?? null };
    }
    return { trace: await fetchDocumentTrace(token, source.id), origin: null, focusedItem: null };
  }
  return { trace: await fetchPipelineRunTrace(token, source.id), origin: null, focusedItem: null };
}

/**
 * Loads everything the trace debugger page needs from its route source: the
 * trace (end-to-end when a chunk is targeted), the node-spec catalog, and the
 * playback graph built from both.
 */
export function useTraceDebugger(source: TraceSource): UseTraceDebuggerResult {
  const { token } = useAuth();
  const sourceKey = `${source.kind}:${source.id}:${source.chunkId ?? ""}`;
  const [focusState, setFocusState] = useState<FocusState>({
    sourceKey,
    itemId: source.chunkId,
  });
  const focusedItemId = focusState.sourceKey === sourceKey ? focusState.itemId : source.chunkId;
  const traceChunkId = source.kind === "query" ? (source.chunkId ?? focusedItemId) : source.chunkId;
  const traceSource = { ...source, chunkId: traceChunkId };

  const traceQuery = useApiQuery(
    () => loadTrace(token ?? "", traceSource),
    [token, source.kind, source.id, traceChunkId],
    { enabled: Boolean(token) },
  );
  const specsQuery = useApiQuery(() => fetchPipelineNodes(token ?? ""), [token], {
    enabled: Boolean(token),
  });

  const specs = specsQuery.data;
  const graph = useMemo(() => {
    if (!traceQuery.data || specsQuery.loading) return null;
    const { trace, origin } = traceQuery.data;
    return buildTraceGraph(trace, origin, specs ?? []);
  }, [traceQuery.data, specs, specsQuery.loading]);

  return {
    graph,
    trace: traceQuery.data?.trace ?? null,
    origin: traceQuery.data?.origin ?? null,
    loading: traceQuery.loading || specsQuery.loading,
    error: traceQuery.error,
    reload: traceQuery.reload,
    focusedItemId,
    focusedItem: focusedItemId ? (traceQuery.data?.focusedItem ?? null) : null,
    focusItem: (itemId) => setFocusState({ sourceKey, itemId }),
    clearFocus: () => setFocusState({ sourceKey, itemId: null }),
    specsNotice: specsQuery.error
      ? "Node details are unavailable right now; showing the trace without them."
      : null,
  };
}
