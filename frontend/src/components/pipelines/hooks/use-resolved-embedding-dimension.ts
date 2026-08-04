"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { fetchEmbeddingDimension } from "@/lib/api";
import { SharedQueryStore } from "@/lib/shared-query-store";

import type { SharedQuerySnapshot } from "@/lib/shared-query-store";
import type { EmbeddingDimensionResponse } from "@/lib/types";

interface DimensionKey {
  connectionId: string;
  modelId: string;
}

// The shared cache layer (`app/AGENTS.md`'s "use the shared cache layer"
// rule, mirrored on the frontend): one entry per (connection_id, model_name)
// pair, for the lifetime of the tab, shared by every hook instance -- never a
// feature-local Map.
const store = new SharedQueryStore<DimensionKey, EmbeddingDimensionResponse>(
  (key) => `${key.connectionId}:${key.modelId}`,
);

const EMPTY_SNAPSHOT: SharedQuerySnapshot<EmbeddingDimensionResponse> = Object.freeze({
  data: null,
  loading: false,
  error: null,
  invalidated: false,
});

const noopUnsubscribe = () => {};

/**
 * The vector width one embedding model actually produces: the catalog's own
 * published `dimension` when `catalogDimension` states one, else a single
 * memoised lookup against the resolve-width endpoint
 * (`GET /api/connections/{id}/models/embedding-dimension`) -- OpenRouter
 * publishes no width for any embedding model, so every one of its models
 * falls to this path.
 *
 * One request per `(connection_id, model_name)` pair, ever, shared across
 * every hook instance and re-render: probing every model just to render a
 * picker is the documented anti-pattern this guards against (see the Ollama
 * catalog note in `app/AGENTS.md`) -- this hook only ever resolves the
 * single pair it's given, and a pair already resolved (successfully or not)
 * is never re-requested.
 *
 * `null` covers "no selection yet", "in flight", and "failed" alike -- the
 * caller treats it as unknown, never as a mismatch, and a failed lookup is
 * never surfaced as an error: an unresolved width is a silent non-answer,
 * not a problem the user caused.
 */
export function useResolvedEmbeddingDimension(
  token: string | null,
  connectionId: string | null,
  modelId: string | null,
  catalogDimension: number | null | undefined,
): number | null {
  const key = useMemo<DimensionKey | null>(
    () => (connectionId && modelId ? { connectionId, modelId } : null),
    [connectionId, modelId],
  );
  const needsLookup = typeof catalogDimension !== "number" && Boolean(key) && Boolean(token);

  const subscribe = useCallback(
    (listener: () => void) => (key ? store.subscribe(key, listener) : noopUnsubscribe),
    [key],
  );
  const getSnapshot = useCallback(() => (key ? store.snapshot(key) : EMPTY_SNAPSHOT), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!needsLookup || !key || !token) return;
    // Already in flight, already resolved (even to "no width"), or already
    // failed once -- nothing new to request for this pair.
    if (snapshot.loading || snapshot.data !== null || snapshot.error !== null) return;
    const { connectionId: keyConnectionId, modelId: keyModelId } = key;
    void store.revalidate(key, () => fetchEmbeddingDimension(token, keyConnectionId, keyModelId));
  }, [needsLookup, key, token, snapshot.loading, snapshot.data, snapshot.error]);

  if (typeof catalogDimension === "number") return catalogDimension;
  return typeof snapshot.data?.dimension === "number" ? snapshot.data.dimension : null;
}
