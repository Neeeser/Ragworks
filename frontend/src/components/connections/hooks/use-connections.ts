"use client";

import { useCallback, useMemo } from "react";

import { listConnections, listProviderTypes } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { ProviderConnection, ProviderKind, ProviderTypeInfo } from "@/lib/types";

export interface UseConnectionsResult {
  connections: ProviderConnection[];
  connectionsLoading: boolean;
  connectionsResolved: boolean;
  connectionsError: string | null;
  reloadConnections: () => void;
  hasKind: (kind: ProviderKind) => boolean;
}

/** Loads the user's provider connections (shared by chat, settings, and the wizard). */
export function useConnections(authToken: string, authLoading = false): UseConnectionsResult {
  const query = useCallback(async () => {
    if (authLoading || !authToken) {
      return [] as ProviderConnection[];
    }
    return listConnections(authToken);
  }, [authLoading, authToken]);

  const { data, loading, error, reload } = useApiQuery(query, [query]);
  const connections = useMemo(() => data ?? [], [data]);

  const hasKind = useCallback(
    // A row with an invalid stored config lists its descriptor's potential
    // kinds so it stays visible, but it cannot serve models — counting it
    // would enable features the backend coverage check rejects.
    (kind: ProviderKind) =>
      connections.some(
        (connection) => connection.config_valid !== false && connection.kinds.includes(kind),
      ),
    [connections],
  );

  return {
    connections,
    connectionsLoading: loading || authLoading,
    connectionsResolved: data !== null,
    connectionsError: error,
    reloadConnections: reload,
    hasKind,
  };
}

export interface UseProviderTypesResult {
  providerTypes: ProviderTypeInfo[];
  providerTypesLoading: boolean;
  providerTypesError: string | null;
}

/** Loads the provider-type catalog that drives the generic add-connection form. */
export function useProviderTypes(authToken: string, authLoading = false): UseProviderTypesResult {
  const query = useCallback(async () => {
    if (authLoading || !authToken) {
      return [] as ProviderTypeInfo[];
    }
    return listProviderTypes(authToken);
  }, [authLoading, authToken]);

  const { data, loading, error } = useApiQuery(query, [query]);

  return {
    providerTypes: useMemo(() => data ?? [], [data]),
    providerTypesLoading: loading || authLoading,
    providerTypesError: error,
  };
}
