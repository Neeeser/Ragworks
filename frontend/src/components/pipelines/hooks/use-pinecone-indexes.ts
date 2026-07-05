"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { listPineconeIndexes } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { PineconeIndex } from "@/lib/types";

export interface UsePineconeIndexesResult {
  indexes: PineconeIndex[];
  indexesLoading: boolean;
  indexesError: string | null;
  refreshIndexes: () => void;
}

/**
 * Loads the Pinecone index list for the current API key. Both the initial load and
 * manual "Refresh" action go through the single `load` function below - the original
 * component had two near-identical fetch/loading/error blocks (one for the mount
 * effect, one for the refresh callback) that have been unified here.
 */
export function usePineconeIndexes(token: string | null): UsePineconeIndexesResult {
  const [indexes, setIndexes] = useState<PineconeIndex[]>([]);
  const [indexesLoading, setIndexesLoading] = useState(false);
  const [indexesError, setIndexesError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (authToken: string) => {
    const requestId = ++requestIdRef.current;
    setIndexesLoading(true);
    setIndexesError(null);
    try {
      const data = await listPineconeIndexes(authToken);
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
