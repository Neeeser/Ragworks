import type {
  ModelParameterKey,
  ParameterDefinition,
  ParameterOverrides,
} from "@/lib/chat-parameters";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type {
  Collection,
  ModelEndpointDirectory,
  ModelInfo,
  RunSettingsSectionKey,
  UsageBreakdown,
} from "@/lib/types";

export interface ProviderFormState {
  sort: string;
  order: string[];
  only: string[];
  ignore: string[];
  quantizations: string[];
  allowFallbacks: boolean;
  requireParameters: boolean;
  dataCollection: "allow" | "deny";
  zdr: boolean;
  enforceDistillableText: boolean;
  maxPrompt: string;
  maxCompletion: string;
  maxRequest: string;
  maxImage: string;
}

export type ProviderSelectionField = "order" | "only" | "ignore";

// ---------------------------------------------------------------------------
// Grouped TelemetryPanel props — one object per run-settings domain so the panel
// takes a handful of stable, memoisable groups instead of ~78 flat props.
// ---------------------------------------------------------------------------

export interface TelemetrySectionIds {
  systemPrompt: string;
  collectionTools: string;
  streaming: string;
  modelRouting: string;
  providerRouting: string;
  modelParameters: string;
  vitals: string;
  usage: string;
}

export interface TelemetrySectionsProps {
  sectionIds: TelemetrySectionIds;
  sectionOrder: RunSettingsSectionKey[];
  onSectionOrderChange: (order: RunSettingsSectionKey[]) => void;
}

export interface TelemetryPromptsProps {
  systemPromptCustom: boolean;
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
}

export interface TelemetryCollectionsProps {
  collections: Collection[];
  selectedToolCollectionIds: string[];
  onToggleToolCollection: (collectionId: string) => void;
  onClearToolCollections: () => void;
  collectionsLoading: boolean;
  collectionsError: string | null;
  collectionToolsOpen: boolean;
  onCollectionToolsToggle: () => void;
  vitalsOpen: boolean;
  onVitalsToggle: () => void;
  collection: Collection | null;
  collectionCount: number;
  documentCount: number;
}

export interface TelemetryStreamingProps {
  streamingOptionsOpen: boolean;
  onStreamingOptionsToggle: () => void;
  streamingEnabled: boolean;
  onStreamingToggle: (enabled: boolean) => void;
}

export interface TelemetryModelProps {
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
}

export interface TelemetryProviderProps {
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
}

export interface TelemetryParametersProps {
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
}

export interface TelemetryUsageProps {
  usageOpen: boolean;
  onUsageToggle: () => void;
  usage: UsageBreakdown | null;
  contextWindow: number;
  contextConsumed: number;
  onExportChatHistory: () => void;
}
