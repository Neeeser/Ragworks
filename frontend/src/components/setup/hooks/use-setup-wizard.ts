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
  fetchEmbeddingDimension,
  fetchIndexBackends,
} from "@/lib/api";
import { chunkDefaultsFor } from "@/lib/chunk-defaults";
import { getErrorMessage } from "@/lib/errors";
import { useSharedModelCatalog } from "@/lib/model-catalog-cache";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";
import { useSetupStatus } from "@/providers/setup-status-provider";

import type { SetupChoices, SetupWizardState } from "@/components/setup/lib/setup-wizard-reducer";
import type {
  BackendInfo,
  CatalogModel,
  ModelCatalogResponse,
  ProviderConnection,
  ProviderKind,
  ProviderTypeInfo,
} from "@/lib/types";

export interface SetupWizardApi {
  state: SetupWizardState;
  next: () => void;
  back: () => void;
  setChoices: (choices: Partial<SetupChoices>) => void;
  /** Seed chunk size/overlap from a model's window (until the user edits them). */
  seedChunkDefaults: (maxInputTokens: number | null | undefined) => void;
  /** Set chunk size/overlap and pin them against further model-derived seeding. */
  setChunk: (patch: { chunkSize?: number; chunkOverlap?: number }) => void;
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
  modelCatalog: ModelCatalogResponse | null;
  refreshModels: () => Promise<void>;
  modelsLoading: boolean;
  modelsError: string | null;
  backends: BackendInfo[] | null;
  suggestedModelId: string | null;
  /** Reranking is optional: these drive the "add a reranker" checkbox + picker. */
  hasRerankingProvider: boolean;
  rerankingModels: CatalogModel[] | null;
  rerankingModelsLoading: boolean;
  /** Creates (or adopts) the index, then advances. */
  ensureIndex: () => Promise<void>;
  /** Installs pipelines + first collection, then lands on the collection. */
  finish: () => Promise<void>;
  busy: boolean;
  error: string | null;
  warning: string | null;
  clearError: () => void;
}

/** One state domain: wizard progression, remote catalogs, and mutations. */
export function useSetupWizard(): SetupWizardApi {
  const { token, user, loading: authLoading } = useAuth();
  const { markComplete } = useSetupStatus();
  const router = useRouter();
  const [state, dispatch] = useReducer(setupWizardReducer, "pgvector", initialSetupWizardState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [completedCollectionId, setCompletedCollectionId] = useState<string | null>(null);

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
  const hasRerankingProvider = coverage.reranking;

  const modelsQuery = useSharedModelCatalog(
    user?.id,
    authToken,
    "embedding",
    Boolean(authToken) && hasEmbeddingProvider,
  );
  const rerankingModelsQuery = useSharedModelCatalog(
    user?.id,
    authToken,
    "reranking",
    Boolean(authToken) && hasRerankingProvider,
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
  const seedChunkDefaults = useCallback((maxInputTokens: number | null | undefined) => {
    const { chunkSize, chunkOverlap } = chunkDefaultsFor(maxInputTokens);
    dispatch({ type: "SEED_CHUNK_DEFAULTS", chunkSize, chunkOverlap });
  }, []);
  const setChunk = useCallback(
    (patch: { chunkSize?: number; chunkOverlap?: number }) =>
      dispatch({ type: "SET_CHUNK", ...patch }),
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
    const { backend, indexName, embeddingConnectionId, embeddingModel } = state.choices;
    setBusy(true);
    setError(null);
    try {
      // The unified model catalog leaves `dimension` null for providers that
      // don't report it (OpenRouter embedding models), so resolve it against
      // the connection before creating a dense index — otherwise the create
      // request omits the dimension and the backend rejects it with a 422.
      let embeddingDimension = state.choices.embeddingDimension;
      if (embeddingDimension == null && embeddingConnectionId && embeddingModel) {
        const resolved = await fetchEmbeddingDimension(
          token,
          embeddingConnectionId,
          embeddingModel,
        ).catch(() => null);
        embeddingDimension = resolved?.dimension ?? null;
        if (embeddingDimension != null) {
          setChoices({ embeddingDimension });
        }
      }
      if (embeddingDimension == null) {
        throw new Error(
          "Could not resolve the embedding model's dimension. Pick a different model, " +
            "or check that the provider connection is reachable.",
        );
      }
      try {
        await createIndex(token, {
          backend,
          name: indexName,
          dimension: embeddingDimension,
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
  }, [token, state.choices, setChoices]);

  const finish = useCallback(async () => {
    if (!token) return;
    if (completedCollectionId) {
      router.replace(`/collections/${completedCollectionId}`);
      return;
    }
    const { choices } = state;
    if (!choices.embeddingConnectionId) {
      setError("Pick an embedding model before finishing setup.");
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const reranker =
        choices.addReranker && choices.rerankerConnectionId && choices.rerankerModel
          ? {
              connection_id: choices.rerankerConnectionId,
              model_name: choices.rerankerModel,
            }
          : null;
      const result = await bootstrapSetup(token, {
        embedding_connection_id: choices.embeddingConnectionId,
        embedding_model: choices.embeddingModel,
        embedding_dimension: choices.embeddingDimension,
        backend: choices.backend,
        index_name: choices.indexName,
        collection_name: choices.collectionName,
        chunk_size: choices.chunkSize,
        chunk_overlap: choices.chunkOverlap,
        add_count_tool: choices.addCountTool,
        add_facet_tool: choices.addFacetTool,
        reranker,
      });
      markComplete();
      if ((result.warnings ?? []).length > 0) {
        setCompletedCollectionId(result.collection.id);
        setWarning(
          `Setup finished with warnings: ${result.warnings.map((issue) => issue.message).join(" ")} Select Finish setup again to continue.`,
        );
        setBusy(false);
        return;
      }
      router.replace(`/collections/${result.collection.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Could not finish setup."));
      setBusy(false);
    }
  }, [token, state, markComplete, router, completedCollectionId]);

  const modelConnectionError =
    (modelsQuery.data?.connection_errors ?? [])
      .map((entry) => `${entry.connection_label}: ${entry.message}`)
      .join(" — ") || null;

  return {
    state,
    next,
    back,
    setChoices,
    seedChunkDefaults,
    setChunk,
    connections,
    providerTypes,
    connectionsLoading,
    connectionsError,
    reloadConnections: handleConnectionsChanged,
    coverage,
    providersReady,
    models,
    modelCatalog: modelsQuery.data,
    refreshModels: modelsQuery.refresh,
    modelsLoading: modelsQuery.loading,
    modelsError: modelsQuery.error ?? modelConnectionError,
    backends: backendsQuery.data,
    suggestedModelId,
    hasRerankingProvider,
    rerankingModels: rerankingModelsQuery.data?.models ?? null,
    rerankingModelsLoading: rerankingModelsQuery.loading,
    ensureIndex,
    finish,
    busy,
    error,
    warning,
    clearError: () => setError(null),
  };
}
