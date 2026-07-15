"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { fetchEmbeddingModels, listChatModels } from "@/lib/api";
import { SharedQueryStore } from "@/lib/shared-query-store";

import type { ModelCatalogResponse, ProviderKind, UUID } from "@/lib/types";

type ModelKind = Extract<ProviderKind, "chat" | "embedding">;
export type ModelAvailability = "available" | "unknown" | "missing";

interface CatalogKey {
  userId: UUID;
  kind: ModelKind;
}

const POLL_INTERVAL_MS = 500;
const POLL_WINDOW_MS = 10_000;
const store = new SharedQueryStore<CatalogKey, ModelCatalogResponse>(
  (key) => `${key.userId}:${key.kind}`,
);
const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pollDeadlines = new Map<string, number>();

const keyId = (key: CatalogKey) => `${key.userId}:${key.kind}`;

function loadCatalog(token: string, kind: ModelKind): Promise<ModelCatalogResponse> {
  return kind === "chat" ? listChatModels(token) : fetchEmbeddingModels(token);
}

async function revalidateCatalog(
  key: CatalogKey,
  token: string,
  resetPolling: boolean,
): Promise<void> {
  const identifier = keyId(key);
  if (resetPolling) pollDeadlines.set(identifier, Date.now() + POLL_WINDOW_MS);
  await store.revalidate(key, () => loadCatalog(token, key.kind));
  const catalog = store.snapshot(key).data;
  const deadline = pollDeadlines.get(identifier) ?? 0;
  if (
    catalog?.meta.refreshing &&
    store.subscriberCount(key) > 0 &&
    Date.now() < deadline &&
    !pollTimers.has(identifier)
  ) {
    pollTimers.set(
      identifier,
      setTimeout(() => {
        pollTimers.delete(identifier);
        void revalidateCatalog(key, token, false);
      }, POLL_INTERVAL_MS),
    );
  } else if (!catalog?.meta.refreshing) {
    pollDeadlines.delete(identifier);
  }
}

function stopPolling(key: CatalogKey): void {
  const identifier = keyId(key);
  const timer = pollTimers.get(identifier);
  if (timer) clearTimeout(timer);
  pollTimers.delete(identifier);
  pollDeadlines.delete(identifier);
}

export function useSharedModelCatalog(
  userId: UUID | null | undefined,
  token: string,
  kind: ModelKind,
  enabled: boolean,
) {
  const key = useMemo<CatalogKey>(() => ({ userId: userId ?? "", kind }), [kind, userId]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribe = store.subscribe(key, listener);
      return () => {
        unsubscribe();
        if (store.subscriberCount(key) === 0) stopPolling(key);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => store.snapshot(key), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const active = enabled && Boolean(userId) && Boolean(token);
  const refresh = useCallback(() => {
    if (!active) return Promise.resolve();
    return revalidateCatalog(key, token, true);
  }, [active, key, token]);

  useEffect(() => {
    if (!active) return;
    void revalidateCatalog(key, token, true);
  }, [active, key, token]);

  useEffect(() => {
    if (!active || !snapshot.invalidated) return;
    void revalidateCatalog(key, token, true);
  }, [active, key, snapshot.invalidated, token]);

  return useMemo(() => ({ ...snapshot, refresh }), [refresh, snapshot]);
}

export function invalidateModelCatalogs(userId: UUID, token?: string): void {
  store.invalidate((key) => key.userId === userId);
  if (!token) return;
  for (const kind of ["chat", "embedding"] as const) {
    const key = { userId, kind };
    if (store.subscriberCount(key) > 0) void revalidateCatalog(key, token, true);
  }
}

export function clearModelCatalogsForUser(userId: UUID): void {
  for (const kind of ["chat", "embedding"] as const) stopPolling({ userId, kind });
  store.removeMatching((key) => key.userId === userId);
}

export function modelAvailability(
  catalog: ModelCatalogResponse | null,
  connectionId: UUID | null,
  modelId: string | null,
): ModelAvailability {
  if (!connectionId || !modelId || !catalog) return "unknown";
  if (
    catalog.models.some((model) => model.connection_id === connectionId && model.id === modelId)
  ) {
    return "available";
  }
  if (catalog.meta.freshness === "stale") return "unknown";
  if (catalog.connection_errors.some((error) => error.connection_id === connectionId)) {
    return "unknown";
  }
  return "missing";
}
