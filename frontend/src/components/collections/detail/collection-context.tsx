"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { Loader } from "@/components/ui/loader";
import { Panel } from "@/components/ui/panel";
import { fetchCollection, fetchCollectionStatsById, fetchPipelines } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";
import type { ReactNode } from "react";

type CollectionContextValue = {
  token: string;
  collection: Collection;
  stats: CollectionStats | null;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  onCollectionUpdated: (collection: Collection) => void;
};

const CollectionContext = createContext<CollectionContextValue | null>(null);

/** Collection-scoped data shared by every page under /collections/{id}. */
export function useCollection(): CollectionContextValue {
  const value = useContext(CollectionContext);
  if (!value) {
    throw new Error("useCollection must be used inside CollectionProvider");
  }
  return value;
}

type CollectionProviderProps = {
  collectionId: string;
  children: ReactNode;
};

/**
 * Loads the collection, its stats, and the pipeline catalogs once for the
 * whole collection section; children render only after the collection exists.
 */
export function CollectionProvider({ collectionId, children }: CollectionProviderProps) {
  const { token } = useAuth();
  // Updates from children (e.g. pipeline rebinding) override the fetched copy.
  const [updatedCollection, setUpdatedCollection] = useState<Collection | null>(null);

  const query = useApiQuery(
    async () => {
      const authToken = token ?? "";
      const [collection, stats, ingestion, retrieval] = await Promise.all([
        fetchCollection(authToken, collectionId),
        fetchCollectionStatsById(authToken, collectionId),
        fetchPipelines(authToken, "ingestion"),
        fetchPipelines(authToken, "retrieval"),
      ]);
      return { collection, stats, ingestion, retrieval };
    },
    [token, collectionId],
    { enabled: Boolean(token) },
  );

  const collection =
    updatedCollection && updatedCollection.id === collectionId
      ? updatedCollection
      : (query.data?.collection ?? null);

  const value = useMemo<CollectionContextValue | null>(() => {
    if (!token || !collection || !query.data) {
      return null;
    }
    return {
      token,
      collection,
      stats: query.data.stats,
      ingestionPipelines: query.data.ingestion,
      retrievalPipelines: query.data.retrieval,
      onCollectionUpdated: setUpdatedCollection,
    };
  }, [token, collection, query.data]);

  if (!token || (query.loading && !query.data)) {
    return (
      <Panel className="flex items-center justify-center rounded-3xl p-10">
        <Loader className="h-6 w-6" />
      </Panel>
    );
  }

  if (query.error || !value) {
    return (
      <Panel className="rounded-3xl border border-hairline p-6 text-sm text-body">
        {query.error ?? "Collection not available."}
      </Panel>
    );
  }

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}
