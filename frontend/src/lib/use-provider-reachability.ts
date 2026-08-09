"use client";

import { useMemo } from "react";

import { catalogConnectionErrors, useSharedModelCatalog } from "@/lib/model-catalog-cache";

import type { ConnectionCatalogError, UUID } from "@/lib/types";

/** Which connections failed to answer the last time their models were listed. */
export interface ProviderReachability {
  /** One entry per failed connection, whichever kinds it serves. */
  unreachable: ConnectionCatalogError[];
  /** The same entries by connection id, for surfaces that render per row. */
  byConnectionId: Map<UUID, ConnectionCatalogError>;
}

/**
 * Workspace-wide provider reachability, derived from the model catalogs.
 *
 * There is no separate health probe: a connection is unreachable exactly when
 * its own catalog fetch failed, which is the same fact the pickers show — so a
 * page reporting it here can never disagree with the picker a user opens next.
 * The three catalogs are the shared cached ones, so this joins whatever another
 * surface already loaded rather than starting its own polling.
 *
 * A connection serving more than one kind fails in more than one catalog; the
 * first message wins, because two renderings of one dead host read as two
 * problems.
 */
export function useProviderReachability(
  userId: UUID | null | undefined,
  token: string | null,
): ProviderReachability {
  const enabled = Boolean(userId && token);
  const chat = useSharedModelCatalog(userId, token ?? "", "chat", enabled);
  const embedding = useSharedModelCatalog(userId, token ?? "", "embedding", enabled);
  const reranking = useSharedModelCatalog(userId, token ?? "", "reranking", enabled);

  return useMemo(() => {
    const byConnectionId = new Map<UUID, ConnectionCatalogError>();
    for (const query of [chat, embedding, reranking]) {
      for (const error of catalogConnectionErrors(query.data)) {
        if (!byConnectionId.has(error.connection_id)) byConnectionId.set(error.connection_id, error);
      }
    }
    return { unreachable: [...byConnectionId.values()], byConnectionId };
  }, [chat, embedding, reranking]);
}
