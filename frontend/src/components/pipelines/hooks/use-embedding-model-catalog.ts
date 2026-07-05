"use client";

import { useEffect, useState } from "react";

import { fetchEmbeddingModels } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { EmbeddingModelInfo } from "@/lib/types";

export interface UseEmbeddingModelCatalogResult {
  embeddingModels: EmbeddingModelInfo[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
}

/** Loads the OpenRouter embedding-model catalog used to auto-fill index/embedder
 * dimensions. Search/sort over the list is owned by `useEmbeddingModelFilter` in
 * EmbeddingModelSelectorCard.tsx; this hook only owns the fetch. */
export function useEmbeddingModelCatalog(token: string | null): UseEmbeddingModelCatalogResult {
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelInfo[]>([]);
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false);
  const [embeddingModelsError, setEmbeddingModelsError] = useState<string | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function loadEmbeddingModels() {
      setEmbeddingModelsLoading(true);
      setEmbeddingModelsError(null);
      try {
        const models = await fetchEmbeddingModels(authToken);
        if (!cancelled) {
          setEmbeddingModels(models);
        }
      } catch (error) {
        if (!cancelled) {
          setEmbeddingModelsError(getErrorMessage(error, "Unable to load embedding models."));
        }
      } finally {
        if (!cancelled) setEmbeddingModelsLoading(false);
      }
    }

    loadEmbeddingModels();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { embeddingModels, embeddingModelsLoading, embeddingModelsError };
}
