"use client";

import { useCallback, useMemo, useState } from "react";

import { modelKey } from "@/components/models/model-catalog-filter";
import { fetchModelShortlist, pinModel, recordModelUse, unpinModel } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { CatalogModel, ModelShortlistEntry, ShortlistKind } from "@/lib/types";

/** A shortlist entry joined against the live catalog. */
export interface ShortlistedModel {
  entry: ModelShortlistEntry;
  /** The catalog entry, when the model is still served by its connection. */
  model: CatalogModel | null;
}

export interface UseModelShortlistResult {
  pinned: ShortlistedModel[];
  recent: ShortlistedModel[];
  /** Keys of pinned models, for rendering the star state on any row. */
  isPinned: (model: CatalogModel) => boolean;
  togglePin: (model: CatalogModel) => void;
  recordUse: (model: CatalogModel) => void;
  error: string | null;
  clearError: () => void;
}

function joinToCatalog(
  entries: ModelShortlistEntry[],
  byKey: Map<string, CatalogModel>,
): ShortlistedModel[] {
  return entries.map((entry) => ({
    entry,
    model: byKey.get(modelKey(entry.connection_id, entry.model_id)) ?? null,
  }));
}

/**
 * A user's pinned and recently used models for one kind, joined against the
 * catalog in front of them.
 *
 * A pin whose model has left the catalog resolves to `model: null` rather than
 * being dropped: the row stays visible as unavailable so the user can unpin it,
 * because a pin that silently vanishes looks like the app forgot it. A failed
 * shortlist fetch leaves both lists empty and surfaces through `error` — the
 * picker still has the full catalog to fall back on, so it never blocks
 * choosing a model.
 */
export function useModelShortlist(
  kind: ShortlistKind,
  models: CatalogModel[],
): UseModelShortlistResult {
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  const query = useApiQuery(
    () => (token ? fetchModelShortlist(token, kind) : Promise.resolve(null)),
    [token, kind, localVersion],
  );

  const byKey = useMemo(() => {
    const map = new Map<string, CatalogModel>();
    for (const model of models) {
      map.set(modelKey(model.connection_id, model.id), model);
    }
    return map;
  }, [models]);

  const pinnedEntries = useMemo(() => query.data?.pinned ?? [], [query.data]);
  const recentEntries = useMemo(() => query.data?.recent ?? [], [query.data]);

  const pinnedKeys = useMemo(
    () => new Set(pinnedEntries.map((entry) => modelKey(entry.connection_id, entry.model_id))),
    [pinnedEntries],
  );

  const pinned = useMemo(() => joinToCatalog(pinnedEntries, byKey), [pinnedEntries, byKey]);
  const recent = useMemo(() => joinToCatalog(recentEntries, byKey), [recentEntries, byKey]);

  const isPinned = useCallback(
    (model: CatalogModel) => pinnedKeys.has(modelKey(model.connection_id, model.id)),
    [pinnedKeys],
  );

  const togglePin = useCallback(
    (model: CatalogModel) => {
      if (!token) return;
      setError(null);
      const identity = {
        kind,
        connection_id: model.connection_id,
        model_id: model.id,
      };
      const request = isPinned(model) ? unpinModel(token, identity) : pinModel(token, identity);
      void request
        .then(() => setLocalVersion((version) => version + 1))
        .catch((err) => setError(getErrorMessage(err, "Could not update pinned models.")));
    },
    [token, kind, isPinned],
  );

  const recordUse = useCallback(
    (model: CatalogModel) => {
      if (!token) return;
      void recordModelUse(token, {
        kind,
        connection_id: model.connection_id,
        model_id: model.id,
      })
        .then(() => setLocalVersion((version) => version + 1))
        // Recording a use is bookkeeping the user did not ask for: surfacing
        // its failure would report an error for an action that appeared to
        // succeed, so it stays silent and the selection stands.
        .catch(() => undefined);
    },
    [token, kind],
  );

  const clearError = useCallback(() => setError(null), []);

  return { pinned, recent, isPinned, togglePin, recordUse, error, clearError };
}
