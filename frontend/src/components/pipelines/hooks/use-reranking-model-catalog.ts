"use client";

import { useSharedModelCatalog } from "@/lib/model-catalog-cache";

import type { CatalogModel, ConnectionCatalogError, ModelCatalogResponse, UUID } from "@/lib/types";

export interface UseRerankingModelCatalogResult {
  rerankingModels: CatalogModel[];
  rerankingConnectionErrors: ConnectionCatalogError[];
  rerankingModelsLoading: boolean;
  rerankingModelsError: string | null;
  rerankingCatalog: ModelCatalogResponse | null;
  refreshModels: () => Promise<void>;
}

const EMPTY_MODELS: CatalogModel[] = [];
const EMPTY_CONNECTION_ERRORS: ConnectionCatalogError[] = [];

/** Loads the unified reranking-model catalog across every capable connection. */
export function useRerankingModelCatalog(
  token: string | null,
  userId?: UUID | null,
): UseRerankingModelCatalogResult {
  const query = useSharedModelCatalog(userId, token ?? "", "reranking", Boolean(token && userId));
  const rerankingCatalog = query.data;
  const rerankingModels = rerankingCatalog?.models ?? EMPTY_MODELS;
  const rerankingConnectionErrors = rerankingCatalog?.connection_errors ?? EMPTY_CONNECTION_ERRORS;
  // Only a failure of the whole request — see `useEmbeddingModelCatalog`.
  const rerankingModelsError = query.error;

  return {
    rerankingModels,
    rerankingConnectionErrors,
    rerankingModelsLoading: query.loading,
    rerankingModelsError,
    rerankingCatalog,
    refreshModels: query.refresh,
  };
}
