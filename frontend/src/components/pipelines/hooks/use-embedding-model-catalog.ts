"use client";

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
 * connections), used to auto-fill index/embedder dimensions. Search, filtering,
 * and sort over the list are owned by `ModelPickerInline`; this hook only owns
 * the fetch. */
export function useEmbeddingModelCatalog(
  token: string | null,
  userId?: UUID | null,
): UseEmbeddingModelCatalogResult {
  const query = useSharedModelCatalog(userId, token ?? "", "embedding", Boolean(token && userId));
  const embeddingCatalog = query.data;
  const embeddingModels = embeddingCatalog?.models ?? EMPTY_MODELS;
  const embeddingConnectionErrors = embeddingCatalog?.connection_errors ?? EMPTY_CONNECTION_ERRORS;
  // Only a failure of the whole request. One connection failing is reported
  // against that connection in the picker, not as an error over every provider.
  const embeddingModelsError = query.error;

  return {
    embeddingModels,
    embeddingConnectionErrors,
    embeddingModelsLoading: query.loading,
    embeddingModelsError,
    embeddingCatalog,
    refreshModels: query.refresh,
  };
}
