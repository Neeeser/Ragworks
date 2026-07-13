"use client";

import { useEffect, useState } from "react";

import { fetchEmbeddingModels } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { CatalogModel, ConnectionCatalogError } from "@/lib/types";

export interface UseEmbeddingModelCatalogResult {
  embeddingModels: CatalogModel[];
  embeddingConnectionErrors: ConnectionCatalogError[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
}

/** Loads the unified embedding-model catalog (all embedding-capable provider
 * connections), used to auto-fill index/embedder dimensions. Search/sort over
 * the list is owned by `useEmbeddingModelFilter` in
 * EmbeddingModelSelectorCard.tsx; this hook only owns the fetch. */
export function useEmbeddingModelCatalog(token: string | null): UseEmbeddingModelCatalogResult {
  const [embeddingModels, setEmbeddingModels] = useState<CatalogModel[]>([]);
  const [embeddingConnectionErrors, setEmbeddingConnectionErrors] = useState<
    ConnectionCatalogError[]
  >([]);
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
        const catalog = await fetchEmbeddingModels(authToken);
        if (!cancelled) {
          setEmbeddingModels(catalog.models);
          setEmbeddingConnectionErrors(catalog.connection_errors);
          if (catalog.connection_errors.length > 0) {
            // A degraded connection is still an error the user must see.
            setEmbeddingModelsError(
              catalog.connection_errors
                .map((entry) => `${entry.connection_label}: ${entry.message}`)
                .join(" — "),
            );
          }
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

  return {
    embeddingModels,
    embeddingConnectionErrors,
    embeddingModelsLoading,
    embeddingModelsError,
  };
}
