"use client";

import { useEffect, useMemo, useState } from "react";

import { listChatModels } from "@/lib/api";
import { PARAMETER_DEFINITIONS } from "@/lib/chat-parameters";
import { getErrorMessage } from "@/lib/errors";
import { sortChatModels } from "@/lib/model-sorting";

import { sanitizeModelSlug } from "../../lib/chat-utils";

import type { ModelParameterKey, ParameterDefinition } from "@/lib/chat-parameters";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { CatalogModel, ConnectionCatalogError, UUID } from "@/lib/types";

const PARAMETER_DEFINITION_MAP: Record<ModelParameterKey, ParameterDefinition> =
  PARAMETER_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.key] = definition;
      return acc;
    },
    {} as Record<ModelParameterKey, ParameterDefinition>,
  );

/** Stable UI key for a (connection, model) pair. */
export const modelSelectionKey = (connectionId: UUID, modelId: string) =>
  `${connectionId}::${modelId}`;

interface UseModelCatalogParams {
  authToken: string;
  authLoading: boolean;
  chatProviderConfigured: boolean;
  activeModelId: string | null;
  activeConnectionId: UUID | null;
  toolsEnabled: boolean;
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
  currentModelInfo: CatalogModel | null;
  providerModelSlug: string | null;
  supportedParameterKeys: Set<ModelParameterKey>;
  visibleParameterDefinitions: ParameterDefinition[];
  toolReadyModels: CatalogModel[];
  sortedModelCatalog: CatalogModel[];
  selectedModelKey: string;
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
}: UseModelCatalogParams): UseModelCatalogResult {
  const [modelCatalog, setModelCatalog] = useState<CatalogModel[]>([]);
  const [connectionErrors, setConnectionErrors] = useState<ConnectionCatalogError[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSearchTerm, setModelSearchTerm] = useState("");
  const [modelSortOption, setModelSortOption] = useState<ChatModelSortOption>("price");

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      if (authLoading) {
        return;
      }
      if (!authToken) {
        setModelCatalog([]);
        setModelsLoading(false);
        setModelsError("Sign in to load models.");
        return;
      }
      setModelsLoading(true);
      try {
        const catalog = await listChatModels(authToken);
        if (!cancelled) {
          setModelCatalog(catalog.models);
          setConnectionErrors(catalog.connection_errors);
          if (catalog.connection_errors.length > 0) {
            // A degraded connection is still an error the user must see.
            setModelsError(
              catalog.connection_errors
                .map((entry) => `${entry.connection_label}: ${entry.message}`)
                .join(" — "),
            );
          } else if (catalog.models.length === 0 && !chatProviderConfigured) {
            setModelsError("Add a chat provider in Settings to load models.");
          } else {
            setModelsError(null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setModelsError(getErrorMessage(error, "Unable to load model metadata."));
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };
    loadModels();
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken, chatProviderConfigured]);

  const currentModelInfo = useMemo(() => {
    if (!activeModelId) return null;
    const withinConnection = activeConnectionId
      ? modelCatalog.find(
          (model) => model.id === activeModelId && model.connection_id === activeConnectionId,
        )
      : null;
    return withinConnection ?? modelCatalog.find((model) => model.id === activeModelId) ?? null;
  }, [activeConnectionId, activeModelId, modelCatalog]);

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

  const filteredModelCatalog = useMemo(() => {
    const query = modelSearchTerm.trim().toLowerCase();
    if (!query) return toolReadyModels;
    return toolReadyModels.filter((model) => {
      const haystack = [model.name, model.id, model.connection_label, model.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [modelSearchTerm, toolReadyModels]);

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
    modelsLoading,
    modelsError,
    modelSearchTerm,
    setModelSearchTerm,
    modelSortOption,
    setModelSortOption,
    currentModelInfo,
    providerModelSlug,
    supportedParameterKeys,
    visibleParameterDefinitions,
    toolReadyModels,
    sortedModelCatalog,
    selectedModelKey,
  };
}
