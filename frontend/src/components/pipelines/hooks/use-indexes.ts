"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listIndexes } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { VectorIndex } from "@/lib/types";

export interface UseIndexesResult {
  /** Every index the user can see, registered or not. */
  indexes: VectorIndex[];
  /** Indexes a pipeline binding can point at — registration is the gate. */
  registeredIndexes: VectorIndex[];
  /** Present in a store with no registration row, offered for adoption. */
  unregisteredIndexes: VectorIndex[];
  indexesLoading: boolean;
  indexesError: string | null;
  refreshIndexes: () => void;
}

/**
 * Loads the vector-index list across every backend the user can use (pgvector
 * always; Pinecone when a key is configured). Both the initial load and the
 * manual "Refresh" action go through the single `load` function below.
 *
 * The registered/unregistered split is derived here rather than fetched
 * twice: pickers offer `registeredIndexes` (only a registered index can be
 * bound), while the manager shows everything so an index the operator did not
 * create through the app is still visible.
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

  const registeredIndexes = useMemo(() => indexes.filter((index) => index.registered), [indexes]);
  const unregisteredIndexes = useMemo(
    () => indexes.filter((index) => !index.registered),
    [indexes],
  );

  return {
    indexes,
    registeredIndexes,
    unregisteredIndexes,
    indexesLoading,
    indexesError,
    refreshIndexes,
  };
}
