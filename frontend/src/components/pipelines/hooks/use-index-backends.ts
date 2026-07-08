"use client";

import { fetchIndexBackends } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { BackendInfo } from "@/lib/types";

export interface UseIndexBackendsResult {
  backends: BackendInfo[];
  backendsLoading: boolean;
  backendsError: string | null;
}

/** Loads each vector-store backend's availability, key status, and capability
 * limits, which the wizard and index manager render their forms from. */
export function useIndexBackends(token: string | null): UseIndexBackendsResult {
  const { data, loading, error } = useApiQuery(() => fetchIndexBackends(token ?? ""), [token], {
    enabled: Boolean(token),
  });
  return {
    backends: data ?? [],
    backendsLoading: loading,
    backendsError: error,
  };
}
