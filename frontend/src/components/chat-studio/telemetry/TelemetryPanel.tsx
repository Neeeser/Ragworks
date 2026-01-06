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

import { CollectionToolsCard } from "@/components/chat-studio/telemetry/CollectionToolsCard";
import { CollectionVitalsCard } from "@/components/chat-studio/telemetry/CollectionVitalsCard";
import { ModelParametersCard } from "@/components/chat-studio/telemetry/ModelParametersCard";
import { ModelSelectorCard } from "@/components/chat-studio/telemetry/ModelSelectorCard";
import { ProviderRoutingCard } from "@/components/chat-studio/telemetry/ProviderRoutingCard";
import { StreamingSettingsCard } from "@/components/chat-studio/telemetry/StreamingSettingsCard";
import { SystemPromptCard } from "@/components/chat-studio/telemetry/SystemPromptCard";
import { UsageCard } from "@/components/chat-studio/telemetry/UsageCard";
import { TelemetrySection } from "@/components/chat-studio/TelemetrySection";
import { Button } from "@/components/ui/button";

import type { ProviderFormState } from "@/components/chat-studio/types";
import type {
  ModelParameterKey,
  ParameterDefinition,
  ParameterOverrides,
} from "@/lib/chat-parameters";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { Collection, ModelEndpointDirectory, ModelInfo, UsageBreakdown } from "@/lib/types";
import type { Components } from "react-markdown";

interface TelemetryPanelProps {
  onClose: () => void;
  promptSections: Array<{
    id: string;
    label: string;
    scope: "base" | "collection";
    isCustom: boolean;
  }>;
  promptPreviewMarkdown: string;
  promptLoading: boolean;
  promptError: string | null;
  promptGeneratedAt?: string | null;
  systemPromptOpen: boolean;
  onSystemPromptToggle: () => void;
  onPromptEdit: () => void;
  collections: Collection[];
  selectedToolCollectionIds: string[];
  onToggleToolCollection: (collectionId: string) => void;
  onClearToolCollections: () => void;
  collectionsLoading: boolean;
  collectionsError: string | null;
  pineconeConfigured: boolean;
  collectionToolsOpen: boolean;
  onCollectionToolsToggle: () => void;
  streamingOptionsOpen: boolean;
  onStreamingOptionsToggle: () => void;
  streamingEnabled: boolean;
  onStreamingToggle: (enabled: boolean) => void;
  modelSelectorOpen: boolean;
  onModelSelectorToggle: () => void;
  modelSearchTerm: string;
  onModelSearchChange: (value: string) => void;
  modelSortOption: ChatModelSortOption;
  onModelSortChange: (value: ChatModelSortOption) => void;
  toolReadyModels: ModelInfo[];
  filteredModelCatalog: ModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
  selectedModelKey: string;
  onSelectModel: (id: string) => void;
  currentModelInfo: ModelInfo | null;
  toolsEnabled: boolean;
  providerPreferencesOpen: boolean;
  onProviderPreferencesToggle: () => void;
  providerForm: ProviderFormState;
  setProviderForm: (updater: (prev: ProviderFormState) => ProviderFormState) => void;
  providerDirectory: ModelEndpointDirectory | null;
  providerDirectoryLoading: boolean;
  providerDirectoryError: string | null;
  providerModelSlug: string | null;
  providerSearchTerm: string;
  onProviderSearchChange: (value: string) => void;
  providerRuleCount: number;
  resetProviderPreferences: () => void;
  vitalsOpen: boolean;
  onVitalsToggle: () => void;
  collection: Collection | null;
  collectionCount: number;
  documentCount: number;
  modelParametersOpen: boolean;
  onModelParametersToggle: () => void;
  visibleParameterDefinitions: ParameterDefinition[];
  parameterOverrides: ParameterOverrides;
  activeParameterCount: number;
  resetAllParameters: () => void;
  handleNumberParameterChange: (
    key: ModelParameterKey,
    rawValue: string,
    asInteger?: boolean,
  ) => void;
  handleBooleanParameterChange: (key: ModelParameterKey, checked: boolean) => void;
  handleTextParameterChange: (key: ModelParameterKey, value: string) => void;
  handleSelectParameterChange: (key: ModelParameterKey, value: string) => void;
  handleClearParameter: (key: ModelParameterKey) => void;
  formatDefaultParameter: (key: ModelParameterKey) => string | null;
  usageOpen: boolean;
  onUsageToggle: () => void;
  usage: UsageBreakdown | null;
  contextWindow: number;
  contextConsumed: number;
  onExportChatHistory: () => void;
  markdownComponents: Components;
}

export const TelemetryPanel = ({
  onClose,
  promptSections,
  promptPreviewMarkdown,
  promptLoading,
  promptError,
  promptGeneratedAt,
  systemPromptOpen,
  onSystemPromptToggle,
  onPromptEdit,
  collections,
  selectedToolCollectionIds,
  onToggleToolCollection,
  onClearToolCollections,
  collectionsLoading,
  collectionsError,
  pineconeConfigured,
  collectionToolsOpen,
  onCollectionToolsToggle,
  streamingOptionsOpen,
  onStreamingOptionsToggle,
  streamingEnabled,
  onStreamingToggle,
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
  vitalsOpen,
  onVitalsToggle,
  collection,
  collectionCount,
  documentCount,
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
  usageOpen,
  onUsageToggle,
  usage,
  contextWindow,
  contextConsumed,
  onExportChatHistory,
  markdownComponents,
}: TelemetryPanelProps) => {
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
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
        <TelemetrySection
          title="System prompt"
          description={promptDescription}
          icon={<NotebookPen className="h-4 w-4 text-amber-300" />}
          isOpen={systemPromptOpen}
          onToggle={onSystemPromptToggle}
        >
          <SystemPromptCard
            promptPreviewMarkdown={promptPreviewMarkdown}
            promptSections={promptSections}
            promptLoading={promptLoading}
            promptError={promptError}
            generatedAt={promptGeneratedAt}
            onEdit={onPromptEdit}
            markdownComponents={markdownComponents}
          />
        </TelemetrySection>

        <TelemetrySection
          title="Collection tools"
          description={toolsDescription}
          icon={<Layers className="h-4 w-4 text-cyan-300" />}
          isOpen={collectionToolsOpen}
          onToggle={onCollectionToolsToggle}
        >
          <CollectionToolsCard
            collections={collections}
            selectedCollectionIds={selectedToolCollectionIds}
            onToggle={onToggleToolCollection}
            onClear={onClearToolCollections}
            pineconeConfigured={pineconeConfigured}
            collectionsLoading={collectionsLoading}
            collectionsError={collectionsError}
          />
        </TelemetrySection>

        <TelemetrySection
          title="Streaming"
          description={
            streamingEnabled ? "Live tokens enabled" : "Responses buffered until completion"
          }
          icon={<Share2 className="h-4 w-4 text-emerald-300" />}
          isOpen={streamingOptionsOpen}
          onToggle={onStreamingOptionsToggle}
        >
          <StreamingSettingsCard streamingEnabled={streamingEnabled} onToggle={onStreamingToggle} />
        </TelemetrySection>

        <TelemetrySection
          title="Model routing"
          description={currentModelInfo?.name || selectedModelKey || "Select a chat model"}
          icon={<RotateCcw className="h-4 w-4 text-violet-300" />}
          isOpen={modelSelectorOpen}
          onToggle={onModelSelectorToggle}
        >
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
        </TelemetrySection>

        <TelemetrySection
          title="Provider routing"
          description={
            providerRuleCount === 0
              ? "Load balance across top providers"
              : `${providerRuleCount} routing rule${providerRuleCount === 1 ? "" : "s"} configured`
          }
          icon={<Share2 className="h-4 w-4 text-emerald-300" />}
          isOpen={providerPreferencesOpen}
          onToggle={onProviderPreferencesToggle}
        >
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
        </TelemetrySection>

        <TelemetrySection
          title="Collection vitals"
          description="Current ingestion settings"
          icon={<MessageCircle className="h-4 w-4 text-cyan-300" />}
          isOpen={vitalsOpen}
          onToggle={onVitalsToggle}
        >
          <CollectionVitalsCard
            collection={collection}
            collectionCount={collectionCount}
            documentCount={documentCount}
          />
        </TelemetrySection>

        <TelemetrySection
          title="Model parameters"
          description={
            currentModelInfo
              ? `${activeParameterCount} override${activeParameterCount === 1 ? "" : "s"} active`
              : "Load model metadata"
          }
          icon={<SlidersHorizontal className="h-4 w-4 text-violet-300" />}
          isOpen={modelParametersOpen}
          onToggle={onModelParametersToggle}
        >
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
        </TelemetrySection>

        <TelemetrySection
          title="Usage"
          description={
            contextWindow
              ? `${contextConsumed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
              : `${contextConsumed.toLocaleString()} tokens consumed`
          }
          isOpen={usageOpen}
          onToggle={onUsageToggle}
        >
          <UsageCard
            usage={usage}
            contextWindow={contextWindow}
            contextConsumed={contextConsumed}
            onExport={onExportChatHistory}
          />
        </TelemetrySection>
      </div>
    </div>
  );
};
