"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useReducer, useState } from "react";

import { computeKindCoverage } from "@/components/connections/ConnectionsManager";
import { useConnections, useProviderTypes } from "@/components/connections/hooks/use-connections";
import {
  initialSetupWizardState,
  setupWizardReducer,
  SUGGESTED_MODEL_FRAGMENT,
} from "@/components/setup/lib/setup-wizard-reducer";
import {
  bootstrapSetup,
  createIndex,
  describeIndex,
  fetchEmbeddingModels,
  fetchIndexBackends,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";
import { useSetupStatus } from "@/providers/setup-status-provider";

import type { SetupChoices, SetupWizardState } from "@/components/setup/lib/setup-wizard-reducer";
import type {
  BackendInfo,
  CatalogModel,
  ProviderConnection,
  ProviderKind,
  ProviderTypeInfo,
} from "@/lib/types";

export interface SetupWizardApi {
  state: SetupWizardState;
  next: () => void;
  back: () => void;
  setChoices: (choices: Partial<SetupChoices>) => void;
  // Providers step
  connections: ProviderConnection[];
  providerTypes: ProviderTypeInfo[];
  connectionsLoading: boolean;
  connectionsError: string | null;
  reloadConnections: () => void;
  coverage: Record<ProviderKind, boolean>;
  providersReady: boolean;
  // Model step
  models: CatalogModel[] | null;
  modelsLoading: boolean;
  modelsError: string | null;
  backends: BackendInfo[] | null;
  suggestedModelId: string | null;
  /** Creates (or adopts) the index, then advances. */
  ensureIndex: () => Promise<void>;
  /** Installs pipelines + first collection, then lands on the collection. */
  finish: () => Promise<void>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

/** One state domain: wizard progression, remote catalogs, and mutations. */
export function useSetupWizard(): SetupWizardApi {
  const { token, loading: authLoading } = useAuth();
  const { markComplete } = useSetupStatus();
  const router = useRouter();
  const [state, dispatch] = useReducer(setupWizardReducer, "pgvector", initialSetupWizardState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authToken = token ?? "";
  const { connections, connectionsLoading, connectionsError, reloadConnections } = useConnections(
    authToken,
    authLoading,
  );
  const { providerTypes } = useProviderTypes(authToken, authLoading);

  const coverage = useMemo(
    () => computeKindCoverage(connections, providerTypes),
    [connections, providerTypes],
  );
  const providersReady = coverage.embedding && coverage.chat && coverage.vector_store;
  const hasEmbeddingProvider = coverage.embedding;

  // `connections` identity changes on every reload, so adding a second
  // embedding provider mid-wizard refetches the catalog too.
  const modelsQuery = useApiQuery(
    () => fetchEmbeddingModels(authToken),
    [authToken, hasEmbeddingProvider, connections],
    { enabled: Boolean(authToken) && hasEmbeddingProvider },
  );
  const backendsQuery = useApiQuery(() => fetchIndexBackends(authToken), [authToken], {
    enabled: Boolean(authToken),
  });
  const reloadBackends = backendsQuery.reload;

  const handleConnectionsChanged = useCallback(() => {
    reloadConnections();
    // Backend `configured` flags (e.g. Pinecone) derive from connections, so
    // the index step must see a freshly added connection without a reload.
    reloadBackends();
  }, [reloadBackends, reloadConnections]);

  const models = modelsQuery.data?.models ?? null;

  const suggestedModelId = useMemo(() => {
    const match = models?.find((model) =>
      model.id.toLowerCase().includes(SUGGESTED_MODEL_FRAGMENT),
    );
    return match?.id ?? null;
  }, [models]);

  const setChoices = useCallback(
    (choices: Partial<SetupChoices>) => dispatch({ type: "SET_CHOICES", choices }),
    [],
  );
  const next = useCallback(() => {
    setError(null);
    dispatch({ type: "NEXT" });
  }, []);
  const back = useCallback(() => {
    setError(null);
    dispatch({ type: "BACK" });
  }, []);

  const ensureIndex = useCallback(async () => {
    if (!token) return;
    const { backend, indexName, embeddingDimension } = state.choices;
    setBusy(true);
    setError(null);
    try {
      try {
        await createIndex(token, {
          backend,
          name: indexName,
          dimension: embeddingDimension ?? undefined,
          metric: "cosine",
        });
      } catch (err) {
        // Adopt an existing index only when its dimension matches the model.
        const existing = await describeIndex(token, backend, indexName).catch(() => null);
        if (!existing) throw err;
        if (
          embeddingDimension != null &&
          existing.dimension != null &&
          existing.dimension !== embeddingDimension
        ) {
          throw new Error(
            `Index "${indexName}" already exists with dimension ${existing.dimension}; ` +
              `pick a different name or a ${existing.dimension}-dimension model.`,
          );
        }
      }
      dispatch({ type: "NEXT" });
    } catch (err) {
      setError(getErrorMessage(err, "Could not create the index."));
    } finally {
      setBusy(false);
    }
  }, [token, state.choices]);

  const finish = useCallback(async () => {
    if (!token) return;
    const { choices } = state;
    if (!choices.embeddingConnectionId) {
      setError("Pick an embedding model before finishing setup.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await bootstrapSetup(token, {
        embedding_connection_id: choices.embeddingConnectionId,
        embedding_model: choices.embeddingModel,
        embedding_dimension: choices.embeddingDimension,
        backend: choices.backend,
        index_name: choices.indexName,
        collection_name: choices.collectionName,
        chunk_size: choices.chunkSize,
        chunk_overlap: choices.chunkOverlap,
      });
      markComplete();
      router.replace(`/collections/${result.collection.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Could not finish setup."));
      setBusy(false);
    }
  }, [token, state, markComplete, router]);

  return {
    state,
    next,
    back,
    setChoices,
    connections,
    providerTypes,
    connectionsLoading,
    connectionsError,
    reloadConnections: handleConnectionsChanged,
    coverage,
    providersReady,
    models,
    modelsLoading: modelsQuery.loading,
    modelsError: modelsQuery.error,
    backends: backendsQuery.data,
    suggestedModelId,
    ensureIndex,
    finish,
    busy,
    error,
    clearError: () => setError(null),
  };
}
