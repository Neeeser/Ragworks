"use client";

import { useEffect, useMemo, useState } from "react";

import { listModels } from "@/lib/api";
import { PARAMETER_DEFINITIONS } from "@/lib/chat-parameters";
import { getErrorMessage } from "@/lib/errors";
import { sortChatModels } from "@/lib/model-sorting";

import { sanitizeModelSlug } from "../../lib/chat-utils";

import type { ModelParameterKey, ParameterDefinition } from "@/lib/chat-parameters";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { ModelInfo } from "@/lib/types";

const PARAMETER_DEFINITION_MAP: Record<ModelParameterKey, ParameterDefinition> =
  PARAMETER_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.key] = definition;
      return acc;
    },
    {} as Record<ModelParameterKey, ParameterDefinition>,
  );

interface UseModelCatalogParams {
  authToken: string;
  authLoading: boolean;
  openrouterConfigured: boolean;
  activeModelId: string | null;
  toolsEnabled: boolean;
}

interface UseModelCatalogResult {
  modelCatalog: ModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelSearchTerm: string;
  setModelSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  modelSortOption: ChatModelSortOption;
  setModelSortOption: React.Dispatch<React.SetStateAction<ChatModelSortOption>>;
  currentModelInfo: ModelInfo | null;
  providerModelSlug: string | null;
  supportedParameterKeys: Set<ModelParameterKey>;
  visibleParameterDefinitions: ParameterDefinition[];
  toolReadyModels: ModelInfo[];
  sortedModelCatalog: ModelInfo[];
  selectedModelKey: string;
}

/**
 * Loads the OpenRouter model catalog and derives the searchable/sortable views plus
 * the currently-selected model's metadata (slug, supported parameters). Preserves the
 * auth-gated error messages of the original inline fetch.
 */
export function useModelCatalog({
  authToken,
  authLoading,
  openrouterConfigured,
  activeModelId,
  toolsEnabled,
}: UseModelCatalogParams): UseModelCatalogResult {
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
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
      if (!openrouterConfigured) {
        setModelCatalog([]);
        setModelsLoading(false);
        setModelsError("Add your OpenRouter API key in Settings to load models.");
        return;
      }
      setModelsLoading(true);
      try {
        const items = await listModels(authToken || undefined);
        if (!cancelled) {
          setModelCatalog(items);
          setModelsError(null);
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
  }, [authLoading, authToken, openrouterConfigured]);

  const currentModelInfo = useMemo(() => {
    const lookupId = activeModelId;
    if (!lookupId) return null;
    return (
      modelCatalog.find((model) => model.id === lookupId || model.canonical_slug === lookupId) ??
      null
    );
  }, [activeModelId, modelCatalog]);

  const providerModelSlug = useMemo(() => {
    const slugSource = currentModelInfo?.canonical_slug ?? currentModelInfo?.id ?? null;
    return sanitizeModelSlug(slugSource);
  }, [currentModelInfo?.canonical_slug, currentModelInfo?.id]);

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
      const haystack = [model.name, model.id, model.canonical_slug, model.description]
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

  const selectedModelKey = useMemo(() => activeModelId || "", [activeModelId]);

  return {
    modelCatalog,
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
