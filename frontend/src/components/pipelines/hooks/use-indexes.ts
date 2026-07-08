"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { listIndexes } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { VectorIndex } from "@/lib/types";

export interface UseIndexesResult {
  indexes: VectorIndex[];
  indexesLoading: boolean;
  indexesError: string | null;
  refreshIndexes: () => void;
}

/**
 * Loads the vector-index list across every backend the user can use (pgvector
 * always; Pinecone when a key is configured). Both the initial load and the
 * manual "Refresh" action go through the single `load` function below.
 */
export function useIndexes(token: string | null): UseIndexesResult {
  const [indexes, setIndexes] = useState<VectorIndex[]>([]);
  const [indexesLoading, setIndexesLoading] = useState(false);
  const [indexesError, setIndexesError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (authToken: string) => {
    const requestId = ++requestIdRef.current;
    setIndexesLoading(true);
    setIndexesError(null);
    try {
      const data = await listIndexes(authToken);
      if (requestIdRef.current !== requestId) return;
      setIndexes(data);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setIndexesError(getErrorMessage(error, "Unable to load indexes."));
    } finally {
      if (requestIdRef.current === requestId) {
        setIndexesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    load(authToken);
  }, [token, load]);

  const refreshIndexes = useCallback(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    load(authToken);
  }, [token, load]);

  return { indexes, indexesLoading, indexesError, refreshIndexes };
}
