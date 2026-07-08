"use client";

import {
  Share2,
  PanelRightClose,
  RotateCcw,
  SlidersHorizontal,
  MessageCircle,
  NotebookPen,
  Layers,
} from "lucide-react";
import { memo } from "react";

import { DEFAULT_STREAMING_ENABLED } from "@/components/chat-studio/lib/chat-constants";
import { markdownComponents } from "@/components/chat-studio/lib/chat-utils";
import { CollectionToolsCard } from "@/components/chat-studio/telemetry/CollectionToolsCard";
import { CollectionVitalsCard } from "@/components/chat-studio/telemetry/CollectionVitalsCard";
import { ModelParametersCard } from "@/components/chat-studio/telemetry/ModelParametersCard";
import { ModelSelectorCard } from "@/components/chat-studio/telemetry/ModelSelectorCard";
import { ProviderRoutingCard } from "@/components/chat-studio/telemetry/ProviderRoutingCard";
import {
  SortableSectionList,
  type TelemetrySectionConfig,
} from "@/components/chat-studio/telemetry/SortableSections";
import { StreamingSettingsCard } from "@/components/chat-studio/telemetry/StreamingSettingsCard";
import { SystemPromptCard } from "@/components/chat-studio/telemetry/SystemPromptCard";
import { UsageCard } from "@/components/chat-studio/telemetry/UsageCard";
import { Button } from "@/components/ui/button";

import type {
  TelemetryCollectionsProps,
  TelemetryModelProps,
  TelemetryParametersProps,
  TelemetryPromptsProps,
  TelemetryProviderProps,
  TelemetrySectionsProps,
  TelemetryStreamingProps,
  TelemetryUsageProps,
} from "@/components/chat-studio/lib/types";
import type { RunSettingsSectionKey } from "@/lib/types";

interface TelemetryPanelProps {
  onClose: () => void;
  sections: TelemetrySectionsProps;
  prompts: TelemetryPromptsProps;
  collections: TelemetryCollectionsProps;
  streaming: TelemetryStreamingProps;
  model: TelemetryModelProps;
  provider: TelemetryProviderProps;
  parameters: TelemetryParametersProps;
  usage: TelemetryUsageProps;
}

const TelemetryPanelComponent = ({
  onClose,
  sections,
  prompts,
  collections,
  streaming,
  model,
  provider,
  parameters,
  usage,
}: TelemetryPanelProps) => {
  const { sectionIds, sectionOrder, onSectionOrderChange } = sections;
  const {
    systemPromptCustom,
    promptSections,
    promptPreviewMarkdown,
    promptLoading,
    promptError,
    promptGeneratedAt,
    systemPromptOpen,
    onSystemPromptToggle,
    onPromptEdit,
  } = prompts;
  const {
    collections: collectionList,
    selectedToolCollectionIds,
    onToggleToolCollection,
    onClearToolCollections,
    collectionsLoading,
    collectionsError,
    collectionToolsOpen,
    onCollectionToolsToggle,
    vitalsOpen,
    onVitalsToggle,
    collection,
    collectionCount,
    documentCount,
  } = collections;
  const { streamingOptionsOpen, onStreamingOptionsToggle, streamingEnabled, onStreamingToggle } =
    streaming;
  const {
    modelSelectorOpen,
    onModelSelectorToggle,
    modelSearchTerm,
    onModelSearchChange,
    modelSortOption,
    onModelSortChange,
    toolReadyModels,
    filteredModelCatalog,
    modelsLoading,
    modelsError,
    selectedModelKey,
    onSelectModel,
    currentModelInfo,
    toolsEnabled,
  } = model;
  const {
    providerPreferencesOpen,
    onProviderPreferencesToggle,
    providerForm,
    setProviderForm,
    providerDirectory,
    providerDirectoryLoading,
    providerDirectoryError,
    providerModelSlug,
    providerSearchTerm,
    onProviderSearchChange,
    providerRuleCount,
    resetProviderPreferences,
  } = provider;
  const {
    modelParametersOpen,
    onModelParametersToggle,
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
  } = parameters;
  const {
    usageOpen,
    onUsageToggle,
    usage: usageBreakdown,
    contextWindow,
    contextConsumed,
    onExportChatHistory,
  } = usage;
  const streamingOverrideActive = streamingEnabled !== DEFAULT_STREAMING_ENABLED;
  const promptDescription = promptLoading
    ? "Loading prompt..."
    : promptError
      ? "Prompt unavailable"
      : `${promptSections.length} section${promptSections.length === 1 ? "" : "s"} ready`;
  const toolsDescription =
    selectedToolCollectionIds.length === 0
      ? "No collections enabled"
      : `${selectedToolCollectionIds.length} collection${
          selectedToolCollectionIds.length === 1 ? "" : "s"
        } active`;
  const sectionConfig: Record<RunSettingsSectionKey, TelemetrySectionConfig> = {
    systemPrompt: {
      title: "System prompt",
      description: promptDescription,
      icon: <NotebookPen className="h-4 w-4 text-amber-300" />,
      isOpen: systemPromptOpen,
      onToggle: onSystemPromptToggle,
      sectionId: sectionIds.systemPrompt,
      overrideActive: systemPromptCustom,
      content: (
        <SystemPromptCard
          promptPreviewMarkdown={promptPreviewMarkdown}
          promptSections={promptSections}
          promptLoading={promptLoading}
          promptError={promptError}
          generatedAt={promptGeneratedAt}
          onEdit={onPromptEdit}
          markdownComponents={markdownComponents}
        />
      ),
    },
    collectionTools: {
      title: "Collection tools",
      description: toolsDescription,
      icon: <Layers className="h-4 w-4 text-cyan-300" />,
      isOpen: collectionToolsOpen,
      onToggle: onCollectionToolsToggle,
      sectionId: sectionIds.collectionTools,
      overrideActive: selectedToolCollectionIds.length > 0,
      content: (
        <CollectionToolsCard
          collections={collectionList}
          selectedCollectionIds={selectedToolCollectionIds}
          onToggle={onToggleToolCollection}
          onClear={onClearToolCollections}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
        />
      ),
    },
    streaming: {
      title: "Streaming",
      description: streamingEnabled ? "Live tokens enabled" : "Responses buffered until completion",
      icon: <Share2 className="h-4 w-4 text-emerald-300" />,
      isOpen: streamingOptionsOpen,
      onToggle: onStreamingOptionsToggle,
      sectionId: sectionIds.streaming,
      overrideActive: streamingOverrideActive,
      content: (
        <StreamingSettingsCard streamingEnabled={streamingEnabled} onToggle={onStreamingToggle} />
      ),
    },
    modelRouting: {
      title: "Model routing",
      description: currentModelInfo?.name || selectedModelKey || "Select a chat model",
      icon: <RotateCcw className="h-4 w-4 text-violet-300" />,
      isOpen: modelSelectorOpen,
      onToggle: onModelSelectorToggle,
      sectionId: sectionIds.modelRouting,
      content: (
        <ModelSelectorCard
          currentModelInfo={currentModelInfo}
          selectedModelKey={selectedModelKey}
          toolReadyModels={toolReadyModels}
          filteredModelCatalog={filteredModelCatalog}
          modelSearchTerm={modelSearchTerm}
          onSearchChange={onModelSearchChange}
          sortOption={modelSortOption}
          onSortChange={onModelSortChange}
          modelsLoading={modelsLoading}
          modelsError={modelsError}
          toolsEnabled={toolsEnabled}
          onSelectModel={onSelectModel}
        />
      ),
    },
    providerRouting: {
      title: "Provider routing",
      description:
        providerRuleCount === 0
          ? "Load balance across top providers"
          : `${providerRuleCount} routing rule${providerRuleCount === 1 ? "" : "s"} configured`,
      icon: <Share2 className="h-4 w-4 text-emerald-300" />,
      isOpen: providerPreferencesOpen,
      onToggle: onProviderPreferencesToggle,
      sectionId: sectionIds.providerRouting,
      overrideActive: providerRuleCount > 0,
      content: (
        <ProviderRoutingCard
          providerForm={providerForm}
          setProviderForm={setProviderForm}
          providerDirectory={providerDirectory}
          providerDirectoryLoading={providerDirectoryLoading}
          providerDirectoryError={providerDirectoryError}
          providerModelSlug={providerModelSlug}
          providerSearchTerm={providerSearchTerm}
          onProviderSearchChange={onProviderSearchChange}
          providerRuleCount={providerRuleCount}
          resetProviderPreferences={resetProviderPreferences}
        />
      ),
    },
    vitals: {
      title: "Collection vitals",
      description: "Current ingestion settings",
      icon: <MessageCircle className="h-4 w-4 text-cyan-300" />,
      isOpen: vitalsOpen,
      onToggle: onVitalsToggle,
      sectionId: sectionIds.vitals,
      content: (
        <CollectionVitalsCard
          collection={collection}
          collectionCount={collectionCount}
          documentCount={documentCount}
        />
      ),
    },
    modelParameters: {
      title: "Model parameters",
      description: currentModelInfo
        ? `${activeParameterCount} override${activeParameterCount === 1 ? "" : "s"} active`
        : "Load model metadata",
      icon: <SlidersHorizontal className="h-4 w-4 text-violet-300" />,
      isOpen: modelParametersOpen,
      onToggle: onModelParametersToggle,
      sectionId: sectionIds.modelParameters,
      overrideActive: activeParameterCount > 0,
      content: (
        <ModelParametersCard
          currentModelInfo={currentModelInfo}
          visibleParameterDefinitions={visibleParameterDefinitions}
          parameterOverrides={parameterOverrides}
          activeParameterCount={activeParameterCount}
          resetAllParameters={resetAllParameters}
          handleNumberParameterChange={handleNumberParameterChange}
          handleBooleanParameterChange={handleBooleanParameterChange}
          handleTextParameterChange={handleTextParameterChange}
          handleSelectParameterChange={handleSelectParameterChange}
          handleClearParameter={handleClearParameter}
          formatDefaultParameter={formatDefaultParameter}
          modelsError={modelsError}
          modelsLoading={modelsLoading}
        />
      ),
    },
    usage: {
      title: "Usage",
      description: contextWindow
        ? `${contextConsumed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
        : `${contextConsumed.toLocaleString()} tokens consumed`,
      isOpen: usageOpen,
      onToggle: onUsageToggle,
      sectionId: sectionIds.usage,
      content: (
        <UsageCard
          usage={usageBreakdown}
          contextWindow={contextWindow}
          contextConsumed={contextConsumed}
          onExport={onExportChatHistory}
        />
      ),
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Context</p>
          <h2 className="text-xl font-semibold text-white">Run settings</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
          onClick={onClose}
          aria-label="Close run settings"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <SortableSectionList
        sectionOrder={sectionOrder}
        onSectionOrderChange={onSectionOrderChange}
        sectionConfig={sectionConfig}
      />
    </div>
  );
};

export const TelemetryPanel = memo(TelemetryPanelComponent);
