"use client";

import { useMemo } from "react";

import { useSharedModelCatalog } from "@/lib/model-catalog-cache";

import type { CatalogModel, ConnectionCatalogError, ModelCatalogResponse, UUID } from "@/lib/types";

export interface UseEmbeddingModelCatalogResult {
  embeddingModels: CatalogModel[];
  embeddingConnectionErrors: ConnectionCatalogError[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  embeddingCatalog: ModelCatalogResponse | null;
  refreshModels: () => Promise<void>;
}

const EMPTY_MODELS: CatalogModel[] = [];
const EMPTY_CONNECTION_ERRORS: ConnectionCatalogError[] = [];

/** Loads the unified embedding-model catalog (all embedding-capable provider
 * connections), used to auto-fill index/embedder dimensions. Search/sort over
 * the list is owned by `useEmbeddingModelFilter` in
 * EmbeddingModelSelectorCard.tsx; this hook only owns the fetch. */
export function useEmbeddingModelCatalog(
  token: string | null,
  userId?: UUID | null,
): UseEmbeddingModelCatalogResult {
  const query = useSharedModelCatalog(userId, token ?? "", "embedding", Boolean(token && userId));
  const embeddingCatalog = query.data;
  const embeddingModels = embeddingCatalog?.models ?? EMPTY_MODELS;
  const embeddingConnectionErrors = embeddingCatalog?.connection_errors ?? EMPTY_CONNECTION_ERRORS;
  const embeddingModelsError = useMemo(() => {
    if (query.error) return query.error;
    if (embeddingConnectionErrors.length === 0) return null;
    return embeddingConnectionErrors
      .map((entry) => `${entry.connection_label}: ${entry.message}`)
      .join(" — ");
  }, [embeddingConnectionErrors, query.error]);

  return {
    embeddingModels,
    embeddingConnectionErrors,
    embeddingModelsLoading: query.loading,
    embeddingModelsError,
    embeddingCatalog,
    refreshModels: query.refresh,
  };
}
