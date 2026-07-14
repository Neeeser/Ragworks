"use client";

import { useCallback, useMemo } from "react";

import { createDefaultProviderForm } from "@/components/chat-studio/lib/chat-payload-helpers";

import type { useModelCatalog } from "@/components/chat-studio/hooks/settings/use-model-catalog";
import type { useModelParameters } from "@/components/chat-studio/hooks/settings/use-model-parameters";
import type { useProviderPreferences } from "@/components/chat-studio/hooks/settings/use-provider-preferences";
import type { UsePanelControlsResult } from "@/components/chat-studio/hooks/use-panel-controls";
import type {
  TelemetryModelProps,
  TelemetryParametersProps,
  TelemetryProviderProps,
} from "@/components/chat-studio/lib/types";
import type { CatalogModel } from "@/lib/types";

type ModelCatalog = ReturnType<typeof useModelCatalog>;
type ModelParameters = ReturnType<typeof useModelParameters>;
type ProviderPreferences = ReturnType<typeof useProviderPreferences>;

export interface UseTelemetryModelGroupsParams {
  modelCatalog: ModelCatalog;
  modelParameters: ModelParameters;
  providerPreferences: ProviderPreferences;
  panel: UsePanelControlsResult;
  toolsEnabled: boolean;
  setActiveModelId: (id: string) => void;
  setActiveConnectionId: (id: string | null) => void;
}

export interface UseTelemetryModelGroupsResult {
  telemetryModel: TelemetryModelProps;
  telemetryProvider: TelemetryProviderProps;
  telemetryParameters: TelemetryParametersProps;
}

/**
 * Builds the memoised TelemetryPanel group props for the model-configuration sections:
 * model selector, provider routing (incl. reset), and model parameters.
 */
export function useTelemetryModelGroups(
  params: UseTelemetryModelGroupsParams,
): UseTelemetryModelGroupsResult {
  const {
    modelCatalog,
    modelParameters,
    providerPreferences,
    panel,
    toolsEnabled,
    setActiveModelId,
    setActiveConnectionId,
  } = params;

  const {
    modelSearchTerm,
    setModelSearchTerm,
    modelSortOption,
    setModelSortOption,
    connectionFilter,
    setConnectionFilter,
    connectionOptions,
    toolReadyModels,
    sortedModelCatalog,
    modelsLoading,
    modelsError,
    selectedModelKey,
    currentModelInfo,
    providerModelSlug,
    visibleParameterDefinitions,
  } = modelCatalog;

  const {
    providerForm,
    setProviderForm,
    providerDirectory,
    providerDirectoryLoading,
    providerDirectoryError,
    providerSearchTerm,
    setProviderSearchTerm,
    providerRuleCount,
  } = providerPreferences;

  const {
    parameterOverrides,
    activeParameterCount,
    resetAllParameters,
    handleNumberParameterChange,
    handleBooleanParameterChange,
    handleTextParameterChange,
    handleSelectParameterChange,
    handleClearParameter,
    formatDefaultParameter,
  } = modelParameters;

  const {
    modelSelectorOpen,
    toggleModelSelector,
    providerPreferencesOpen,
    toggleProviderPreferences,
    modelParametersOpen,
    toggleModelParameters,
  } = panel;

  const handleResetProviderPreferences = useCallback(() => {
    setProviderForm(createDefaultProviderForm());
  }, [setProviderForm]);

  const handleSelectModel = useCallback(
    (model: CatalogModel) => {
      setActiveModelId(model.id);
      setActiveConnectionId(model.connection_id);
    },
    [setActiveConnectionId, setActiveModelId],
  );

  const telemetryModel = useMemo<TelemetryModelProps>(
    () => ({
      modelSelectorOpen,
      onModelSelectorToggle: toggleModelSelector,
      modelSearchTerm,
      onModelSearchChange: setModelSearchTerm,
      modelSortOption,
      onModelSortChange: setModelSortOption,
      connectionFilter,
      onConnectionFilterChange: setConnectionFilter,
      connectionOptions,
      toolReadyModels,
      filteredModelCatalog: sortedModelCatalog,
      modelsLoading,
      modelsError,
      selectedModelKey,
      onSelectModel: handleSelectModel,
      currentModelInfo,
      toolsEnabled,
    }),
    [
      connectionFilter,
      connectionOptions,
      currentModelInfo,
      modelSearchTerm,
      modelSelectorOpen,
      modelSortOption,
      modelsError,
      modelsLoading,
      handleSelectModel,
      selectedModelKey,
      setConnectionFilter,
      setModelSearchTerm,
      setModelSortOption,
      sortedModelCatalog,
      toggleModelSelector,
      toolReadyModels,
      toolsEnabled,
    ],
  );

  const telemetryProvider = useMemo<TelemetryProviderProps>(
    () => ({
      providerPreferencesOpen,
      onProviderPreferencesToggle: toggleProviderPreferences,
      providerForm,
      setProviderForm,
      providerDirectory,
      providerDirectoryLoading,
      providerDirectoryError,
      providerModelSlug,
      providerSearchTerm,
      onProviderSearchChange: setProviderSearchTerm,
      providerRuleCount,
      resetProviderPreferences: handleResetProviderPreferences,
    }),
    [
      handleResetProviderPreferences,
      providerDirectory,
      providerDirectoryError,
      providerDirectoryLoading,
      providerForm,
      providerModelSlug,
      providerPreferencesOpen,
      providerRuleCount,
      providerSearchTerm,
      setProviderForm,
      setProviderSearchTerm,
      toggleProviderPreferences,
    ],
  );

  const telemetryParameters = useMemo<TelemetryParametersProps>(
    () => ({
      modelParametersOpen,
      onModelParametersToggle: toggleModelParameters,
      visibleParameterDefinitions,
      parameterOverrides,
      activeParameterCount,
      resetAllParameters,
      handleNumberParameterChange,
      handleBooleanParameterChange,
      handleTextParameterChange,
      handleSelectParameterChange,
      handleClearParameter,
      formatDefaultParameter,
    }),
    [
      activeParameterCount,
      formatDefaultParameter,
      handleBooleanParameterChange,
      handleClearParameter,
      handleNumberParameterChange,
      handleSelectParameterChange,
      handleTextParameterChange,
      modelParametersOpen,
      parameterOverrides,
      resetAllParameters,
      toggleModelParameters,
      visibleParameterDefinitions,
    ],
  );

  return { telemetryModel, telemetryProvider, telemetryParameters };
}
