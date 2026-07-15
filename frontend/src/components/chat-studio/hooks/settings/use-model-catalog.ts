"use client";

import { useMemo, useState } from "react";

import { PARAMETER_DEFINITIONS } from "@/lib/chat-parameters";
import { modelAvailability, useSharedModelCatalog } from "@/lib/model-catalog-cache";
import { sortChatModels } from "@/lib/model-sorting";

import { sanitizeModelSlug } from "../../lib/chat-utils";

import type { ModelParameterKey, ParameterDefinition } from "@/lib/chat-parameters";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { CatalogModel, ConnectionCatalogError, ProviderConnection, UUID } from "@/lib/types";

const PARAMETER_DEFINITION_MAP: Record<ModelParameterKey, ParameterDefinition> =
  PARAMETER_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.key] = definition;
      return acc;
    },
    {} as Record<ModelParameterKey, ParameterDefinition>,
  );
const EMPTY_MODELS: CatalogModel[] = [];
const EMPTY_CONNECTION_ERRORS: ConnectionCatalogError[] = [];

/** Stable UI key for a (connection, model) pair. */
export const modelSelectionKey = (connectionId: UUID, modelId: string) =>
  `${connectionId}::${modelId}`;

export interface ConnectionOption {
  connectionId: UUID;
  label: string;
  providerType: string;
}

interface UseModelCatalogParams {
  authToken: string;
  authLoading: boolean;
  chatProviderConfigured: boolean;
  activeModelId: string | null;
  activeConnectionId: UUID | null;
  toolsEnabled: boolean;
  userId: UUID | null;
  connections: ProviderConnection[];
}

interface UseModelCatalogResult {
  modelCatalog: CatalogModel[];
  connectionErrors: ConnectionCatalogError[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelSearchTerm: string;
  setModelSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  modelSortOption: ChatModelSortOption;
  setModelSortOption: React.Dispatch<React.SetStateAction<ChatModelSortOption>>;
  /** Connection id to restrict the picker to, or "" for every provider. */
  connectionFilter: string;
  setConnectionFilter: React.Dispatch<React.SetStateAction<string>>;
  /** One entry per connection present in the catalog, for the filter dropdown. */
  connectionOptions: ConnectionOption[];
  currentModelInfo: CatalogModel | null;
  providerModelSlug: string | null;
  supportedParameterKeys: Set<ModelParameterKey>;
  visibleParameterDefinitions: ParameterDefinition[];
  toolReadyModels: CatalogModel[];
  sortedModelCatalog: CatalogModel[];
  selectedModelKey: string;
  selectedAvailability: "available" | "unknown" | "missing";
  refreshModels: () => Promise<void>;
}

/**
 * Loads the unified model catalog (every chat-capable provider connection) and
 * derives the searchable/sortable views plus the currently-selected model's
 * metadata (slug, supported parameters). One unreachable connection degrades
 * to a `connectionErrors` entry instead of failing the whole catalog.
 */
export function useModelCatalog({
  authToken,
  authLoading,
  chatProviderConfigured,
  activeModelId,
  activeConnectionId,
  toolsEnabled,
  userId,
  connections,
}: UseModelCatalogParams): UseModelCatalogResult {
  const query = useSharedModelCatalog(
    userId,
    authToken,
    "chat",
    !authLoading && Boolean(authToken) && Boolean(userId),
  );
  const modelCatalog = query.data?.models ?? EMPTY_MODELS;
  const connectionErrors = query.data?.connection_errors ?? EMPTY_CONNECTION_ERRORS;
  const [modelSearchTerm, setModelSearchTerm] = useState("");
  const [modelSortOption, setModelSortOption] = useState<ChatModelSortOption>("price");
  const [connectionFilter, setConnectionFilter] = useState("");

  const currentModelInfo = useMemo(() => {
    if (!activeModelId || !activeConnectionId) return null;
    return (
      modelCatalog.find(
        (model) => model.id === activeModelId && model.connection_id === activeConnectionId,
      ) ?? null
    );
  }, [activeConnectionId, activeModelId, modelCatalog]);

  const selectedAvailability = modelAvailability(query.data, activeConnectionId, activeModelId);
  const modelsError = useMemo(() => {
    if (!authToken) return "Sign in to load models.";
    if (query.error) return query.error;
    if (selectedAvailability === "missing") {
      const label =
        connections.find((connection) => connection.id === activeConnectionId)?.label ??
        "this connection";
      return `Selected model is no longer available from ${label}. Select another model.`;
    }
    if (connectionErrors.length > 0) {
      return connectionErrors
        .map((entry) => `${entry.connection_label}: ${entry.message}`)
        .join(" — ");
    }
    if (modelCatalog.length === 0 && !chatProviderConfigured) {
      return "Add a chat provider in Settings to load models.";
    }
    return null;
  }, [
    activeConnectionId,
    authToken,
    chatProviderConfigured,
    connectionErrors,
    connections,
    modelCatalog.length,
    query.error,
    selectedAvailability,
  ]);

  const providerModelSlug = useMemo(() => {
    if (currentModelInfo?.provider_type !== "openrouter") {
      return null;
    }
    return sanitizeModelSlug(currentModelInfo?.id ?? null);
  }, [currentModelInfo?.id, currentModelInfo?.provider_type]);

  const supportedParameterKeys = useMemo(() => {
    const supported = new Set<ModelParameterKey>();
    if (!currentModelInfo) {
      return supported;
    }
    (currentModelInfo.supported_parameters || []).forEach((param) => {
      const normalized = param.toLowerCase();
      if (normalized in PARAMETER_DEFINITION_MAP) {
        supported.add(normalized as ModelParameterKey);
      }
    });
    return supported;
  }, [currentModelInfo]);

  const visibleParameterDefinitions = useMemo(
    () => PARAMETER_DEFINITIONS.filter((definition) => supportedParameterKeys.has(definition.key)),
    [supportedParameterKeys],
  );

  const toolReadyModels = useMemo(() => {
    if (!toolsEnabled) {
      return modelCatalog;
    }
    return modelCatalog.filter((model) =>
      (model.supported_parameters || []).some((param) => param.toLowerCase() === "tools"),
    );
  }, [modelCatalog, toolsEnabled]);

  const connectionOptions = useMemo(() => {
    const options = new Map<UUID, ConnectionOption>();
    for (const model of modelCatalog) {
      if (!options.has(model.connection_id)) {
        options.set(model.connection_id, {
          connectionId: model.connection_id,
          label: model.connection_label,
          providerType: model.provider_type,
        });
      }
    }
    return [...options.values()];
  }, [modelCatalog]);

  const connectionScopedModels = useMemo(() => {
    if (!connectionFilter) return toolReadyModels;
    return toolReadyModels.filter((model) => model.connection_id === connectionFilter);
  }, [connectionFilter, toolReadyModels]);

  const filteredModelCatalog = useMemo(() => {
    const query = modelSearchTerm.trim().toLowerCase();
    if (!query) return connectionScopedModels;
    return connectionScopedModels.filter((model) => {
      const haystack = [model.name, model.id, model.connection_label, model.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [connectionScopedModels, modelSearchTerm]);

  const sortedModelCatalog = useMemo(
    () => sortChatModels(filteredModelCatalog, modelSortOption),
    [filteredModelCatalog, modelSortOption],
  );

  const selectedModelKey = useMemo(() => {
    if (!activeModelId) return "";
    return activeConnectionId
      ? modelSelectionKey(activeConnectionId, activeModelId)
      : activeModelId;
  }, [activeConnectionId, activeModelId]);

  return {
    modelCatalog,
    connectionErrors,
    modelsLoading: query.loading,
    modelsError,
    modelSearchTerm,
    setModelSearchTerm,
    modelSortOption,
    setModelSortOption,
    connectionFilter,
    setConnectionFilter,
    connectionOptions,
    currentModelInfo,
    providerModelSlug,
    supportedParameterKeys,
    visibleParameterDefinitions,
    toolReadyModels,
    sortedModelCatalog,
    selectedModelKey,
    selectedAvailability,
    refreshModels: query.refresh,
  };
}
