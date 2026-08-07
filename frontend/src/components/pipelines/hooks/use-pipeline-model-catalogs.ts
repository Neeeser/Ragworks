"use client";

import { useCallback, useEffect, useMemo } from "react";

import { useConnections } from "@/components/connections/hooks/use-connections";

import {
  RERANKER_PROVIDER_ERROR,
  RERANKER_PROVIDER_LOADING,
  RERANKER_PROVIDER_REQUIRED,
} from "../lib/reranking";

import { useEmbeddingModelCatalog } from "./use-embedding-model-catalog";
import { useLlmModelCatalog } from "./use-llm-model-catalog";
import { useRerankingModelCatalog } from "./use-reranking-model-catalog";

import type { UUID } from "@/lib/types";

/** Model catalogs and provider availability used by the pipeline editor. */
export function usePipelineModelCatalogs(token: string | null, userId?: UUID | null) {
  const { refreshModels: refreshEmbeddingModels, ...embedding } = useEmbeddingModelCatalog(
    token,
    userId,
  );
  const { refreshModels: refreshRerankingModels, ...reranking } = useRerankingModelCatalog(
    token,
    userId,
  );
  const { refreshModels: refreshLlmModels, ...llm } = useLlmModelCatalog(token, userId);
  const { connectionsLoading, connectionsResolved, connectionsError, hasKind, reloadConnections } =
    useConnections(token ?? "", !token);
  useEffect(() => {
    // A user typically adds their first reranking provider in Settings in
    // another tab or window; without this, the "add a reranking provider"
    // gate stays stale until the next token-rotation refetch (~12 minutes).
    const onFocus = () => reloadConnections();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadConnections]);
  const connectionsPending = connectionsLoading || !connectionsResolved;
  const hasRerankingProvider = !connectionsPending && !connectionsError && hasKind("reranking");
  const rerankingProviderMessage = connectionsError
    ? RERANKER_PROVIDER_ERROR
    : connectionsPending
      ? RERANKER_PROVIDER_LOADING
      : hasRerankingProvider
        ? null
        : RERANKER_PROVIDER_REQUIRED;
  const onEmbeddingCatalogVisible = useCallback(
    () => void refreshEmbeddingModels(),
    [refreshEmbeddingModels],
  );
  const onRerankingCatalogVisible = useCallback(
    () => void refreshRerankingModels(),
    [refreshRerankingModels],
  );
  const onRetryRerankingModels = useCallback(
    () => void refreshRerankingModels(),
    [refreshRerankingModels],
  );
  // The create-pipeline wizard takes the reranking catalog as one prop, so it
  // is grouped here rather than restated at every call site.
  const wizardRerankingCatalog = useMemo(
    () => ({
      models: reranking.rerankingModels,
      catalog: reranking.rerankingCatalog,
      loading: reranking.rerankingModelsLoading,
      error: reranking.rerankingModelsError,
      onVisible: onRerankingCatalogVisible,
      onRetry: onRetryRerankingModels,
    }),
    [
      reranking.rerankingModels,
      reranking.rerankingCatalog,
      reranking.rerankingModelsLoading,
      reranking.rerankingModelsError,
      onRerankingCatalogVisible,
      onRetryRerankingModels,
    ],
  );
  const onLlmCatalogVisible = useCallback(() => void refreshLlmModels(), [refreshLlmModels]);
  const onRetryLlmModels = useCallback(() => void refreshLlmModels(), [refreshLlmModels]);

  return {
    token,
    ...embedding,
    ...reranking,
    ...llm,
    hasRerankingProvider,
    rerankingProviderMessage,
    wizardRerankingCatalog,
    onEmbeddingCatalogVisible,
    onRerankingCatalogVisible,
    onRetryRerankingModels,
    onLlmCatalogVisible,
    onRetryLlmModels,
  };
}
