"use client";

import { useMemo } from "react";

import { useSharedModelCatalog } from "@/lib/model-catalog-cache";

import { structuredOutputCapable } from "../lib/llm";

import type { CatalogModel, ConnectionCatalogError, ModelCatalogResponse, UUID } from "@/lib/types";

export interface UseLlmModelCatalogResult {
  llmModels: CatalogModel[];
  llmConnectionErrors: ConnectionCatalogError[];
  llmModelsLoading: boolean;
  llmModelsError: string | null;
  llmCatalog: ModelCatalogResponse | null;
  refreshModels: () => Promise<void>;
}

const EMPTY_MODELS: CatalogModel[] = [];
const EMPTY_CONNECTION_ERRORS: ConnectionCatalogError[] = [];

/**
 * Chat models for LLM pipeline nodes, narrowed to those advertising a
 * structured-output mechanism (`response_format` or tools) — the engine
 * forces the output shape, so a model without either would degrade to
 * prompt-and-parse, which the picker deliberately doesn't offer.
 */
export function useLlmModelCatalog(
  token: string | null,
  userId?: UUID | null,
): UseLlmModelCatalogResult {
  const query = useSharedModelCatalog(userId, token ?? "", "chat", Boolean(token && userId));
  const llmCatalog = query.data;
  const llmModels = useMemo(
    () => (llmCatalog?.models ?? EMPTY_MODELS).filter(structuredOutputCapable),
    [llmCatalog],
  );
  const llmConnectionErrors = llmCatalog?.connection_errors ?? EMPTY_CONNECTION_ERRORS;
  const llmModelsError = useMemo(() => {
    if (query.error) return query.error;
    if (llmConnectionErrors.length === 0) return null;
    return llmConnectionErrors
      .map((entry) => `${entry.connection_label}: ${entry.message}`)
      .join(" — ");
  }, [query.error, llmConnectionErrors]);

  return {
    llmModels,
    llmConnectionErrors,
    llmModelsLoading: query.loading,
    llmModelsError,
    llmCatalog,
    refreshModels: query.refresh,
  };
}
