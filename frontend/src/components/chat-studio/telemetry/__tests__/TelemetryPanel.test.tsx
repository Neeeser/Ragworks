import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { TelemetryPanel } from "@/components/chat-studio/telemetry/TelemetryPanel";
import { makeCatalogModel } from "@/test/fixtures";

import type {
  ProviderFormState,
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

type DndContextProps = React.PropsWithChildren<{
  onDragStart?: (event: { active: { id: RunSettingsSectionKey } }) => void;
  onDragEnd?: (event: {
    active: { id: RunSettingsSectionKey };
    over?: { id: RunSettingsSectionKey } | null;
  }) => void;
  onDragCancel?: () => void;
}>;

type DragOverlayProps = React.PropsWithChildren<Record<string, unknown>>;
type SortableContextProps = React.PropsWithChildren<Record<string, unknown>>;

let lastDndProps: {
  onDragStart?: (event: { active: { id: RunSettingsSectionKey } }) => void;
  onDragEnd?: (event: {
    active: { id: RunSettingsSectionKey };
    over?: { id: RunSettingsSectionKey } | null;
  }) => void;
  onDragCancel?: () => void;
} = {};

let mockIsDragging = false;

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ onDragStart, onDragEnd, onDragCancel, children }: DndContextProps) => {
    lastDndProps = { onDragStart, onDragEnd, onDragCancel };
    return <div data-testid="dnd-context">{children}</div>;
  },
  DragOverlay: ({ children }: DragOverlayProps) => <div data-testid="drag-overlay">{children}</div>,
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: SortableContextProps) => (
    <div data-testid="sortable">{children}</div>
  ),
  arrayMove: (items: string[], from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    setActivatorNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: mockIsDragging,
  }),
  verticalListSortingStrategy: () => undefined,
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

vi.mock("@dnd-kit/modifiers", () => ({
  restrictToVerticalAxis: () => undefined,
}));

vi.mock("@/components/chat-studio/telemetry/SystemPromptCard", () => ({
  SystemPromptCard: () => <div data-testid="system-prompt-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/CollectionToolsCard", () => ({
  CollectionToolsCard: () => <div data-testid="collection-tools-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/StreamingSettingsCard", () => ({
  StreamingSettingsCard: () => <div data-testid="streaming-settings-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/ModelSelectorCard", () => ({
  ModelSelectorCard: () => <div data-testid="model-selector-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/ProviderRoutingCard", () => ({
  ProviderRoutingCard: () => <div data-testid="provider-routing-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/CollectionVitalsCard", () => ({
  CollectionVitalsCard: () => <div data-testid="collection-vitals-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/ModelParametersCard", () => ({
  ModelParametersCard: () => <div data-testid="model-parameters-card" />,
}));
vi.mock("@/components/chat-studio/telemetry/UsageCard", () => ({
  UsageCard: () => <div data-testid="usage-card" />,
}));

const baseProviderForm: ProviderFormState = {
  sort: "",
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: false,
  dataCollection: "allow",
  zdr: false,
  enforceDistillableText: false,
  maxPrompt: "",
  maxCompletion: "",
  maxRequest: "",
  maxImage: "",
};

const sectionIds = {
  systemPrompt: "system",
  collectionTools: "collections",
  streaming: "streaming",
  modelRouting: "model",
  providerRouting: "provider",
  modelParameters: "params",
  vitals: "vitals",
  usage: "usage",
};

const baseOrder: RunSettingsSectionKey[] = [
  "systemPrompt",
  "collectionTools",
  "streaming",
  "modelRouting",
  "providerRouting",
  "vitals",
  "modelParameters",
  "usage",
];

// Flat overrides get distributed into the grouped props below, so existing call
// sites can keep tweaking a single field (e.g. { promptLoading: true }).
type FlatOverrides = Partial<
  TelemetrySectionsProps &
    TelemetryPromptsProps &
    TelemetryCollectionsProps &
    TelemetryStreamingProps &
    TelemetryModelProps &
    TelemetryProviderProps &
    TelemetryParametersProps &
    TelemetryUsageProps & { onClose: () => void }
>;

const buildProps = (overrides: FlatOverrides = {}): React.ComponentProps<typeof TelemetryPanel> => {
  const f = {
    onClose: vi.fn(),
    sectionIds,
    sectionOrder: baseOrder,
    onSectionOrderChange: vi.fn(),
    systemPromptCustom: false,
    promptSections: [],
    promptPreviewMarkdown: "",
    promptLoading: false,
    promptError: null,
    promptGeneratedAt: null,
    systemPromptOpen: true,
    onSystemPromptToggle: vi.fn(),
    onPromptEdit: vi.fn(),
    collections: [],
    selectedToolCollectionIds: [],
    onToggleToolCollection: vi.fn(),
    onClearToolCollections: vi.fn(),
    collectionsLoading: false,
    collectionsError: null,
    collectionToolsOpen: true,
    onCollectionToolsToggle: vi.fn(),
    streamingOptionsOpen: true,
    onStreamingOptionsToggle: vi.fn(),
    streamingEnabled: true,
    onStreamingToggle: vi.fn(),
    modelSelectorOpen: true,
    onModelSelectorToggle: vi.fn(),
    modelSearchTerm: "",
    onModelSearchChange: vi.fn(),
    modelSortOption: "price" as const,
    onModelSortChange: vi.fn(),
    toolReadyModels: [],
    filteredModelCatalog: [],
    modelsLoading: false,
    modelsError: null,
    selectedModelKey: "",
    onSelectModel: vi.fn(),
    currentModelInfo: null,
    toolsEnabled: false,
    providerPreferencesOpen: true,
    onProviderPreferencesToggle: vi.fn(),
    providerForm: baseProviderForm,
    setProviderForm: vi.fn(),
    providerDirectory: null,
    providerDirectoryLoading: false,
    providerDirectoryError: null,
    providerModelSlug: null,
    providerSearchTerm: "",
    onProviderSearchChange: vi.fn(),
    providerRuleCount: 0,
    resetProviderPreferences: vi.fn(),
    vitalsOpen: true,
    onVitalsToggle: vi.fn(),
    collection: null,
    collectionCount: 0,
    documentCount: 0,
    modelParametersOpen: true,
    onModelParametersToggle: vi.fn(),
    visibleParameterDefinitions: [],
    parameterOverrides: {},
    activeParameterCount: 0,
    resetAllParameters: vi.fn(),
    handleNumberParameterChange: vi.fn(),
    handleBooleanParameterChange: vi.fn(),
    handleTextParameterChange: vi.fn(),
    handleSelectParameterChange: vi.fn(),
    handleClearParameter: vi.fn(),
    formatDefaultParameter: vi.fn(),
    usageOpen: true,
    onUsageToggle: vi.fn(),
    usage: null,
    contextWindow: 0,
    contextConsumed: 0,
    onExportChatHistory: vi.fn(),
    ...overrides,
  };
  return {
    onClose: f.onClose,
    sections: {
      sectionIds: f.sectionIds,
      sectionOrder: f.sectionOrder,
      onSectionOrderChange: f.onSectionOrderChange,
    },
    prompts: {
      systemPromptCustom: f.systemPromptCustom,
      promptSections: f.promptSections,
      promptPreviewMarkdown: f.promptPreviewMarkdown,
      promptLoading: f.promptLoading,
      promptError: f.promptError,
      promptGeneratedAt: f.promptGeneratedAt,
      systemPromptOpen: f.systemPromptOpen,
      onSystemPromptToggle: f.onSystemPromptToggle,
      onPromptEdit: f.onPromptEdit,
    },
    collections: {
      collections: f.collections,
      selectedToolCollectionIds: f.selectedToolCollectionIds,
      onToggleToolCollection: f.onToggleToolCollection,
      onClearToolCollections: f.onClearToolCollections,
      collectionsLoading: f.collectionsLoading,
      collectionsError: f.collectionsError,
      collectionToolsOpen: f.collectionToolsOpen,
      onCollectionToolsToggle: f.onCollectionToolsToggle,
      vitalsOpen: f.vitalsOpen,
      onVitalsToggle: f.onVitalsToggle,
      collection: f.collection,
      collectionCount: f.collectionCount,
      documentCount: f.documentCount,
    },
    streaming: {
      streamingOptionsOpen: f.streamingOptionsOpen,
      onStreamingOptionsToggle: f.onStreamingOptionsToggle,
      streamingEnabled: f.streamingEnabled,
      onStreamingToggle: f.onStreamingToggle,
    },
    model: {
      modelSelectorOpen: f.modelSelectorOpen,
      onModelSelectorToggle: f.onModelSelectorToggle,
      modelSearchTerm: f.modelSearchTerm,
      onModelSearchChange: f.onModelSearchChange,
      modelSortOption: f.modelSortOption,
      onModelSortChange: f.onModelSortChange,
      connectionFilter: "",
      onConnectionFilterChange: vi.fn(),
      connectionOptions: [],
      toolReadyModels: f.toolReadyModels,
      filteredModelCatalog: f.filteredModelCatalog,
      modelsLoading: f.modelsLoading,
      modelsError: f.modelsError,
      selectedModelKey: f.selectedModelKey,
      onSelectModel: f.onSelectModel,
      currentModelInfo: f.currentModelInfo,
      toolsEnabled: f.toolsEnabled,
    },
    provider: {
      providerPreferencesOpen: f.providerPreferencesOpen,
      onProviderPreferencesToggle: f.onProviderPreferencesToggle,
      providerForm: f.providerForm,
      setProviderForm: f.setProviderForm,
      providerDirectory: f.providerDirectory,
      providerDirectoryLoading: f.providerDirectoryLoading,
      providerDirectoryError: f.providerDirectoryError,
      providerModelSlug: f.providerModelSlug,
      providerSearchTerm: f.providerSearchTerm,
      onProviderSearchChange: f.onProviderSearchChange,
      providerRuleCount: f.providerRuleCount,
      resetProviderPreferences: f.resetProviderPreferences,
    },
    parameters: {
      modelParametersOpen: f.modelParametersOpen,
      onModelParametersToggle: f.onModelParametersToggle,
      visibleParameterDefinitions: f.visibleParameterDefinitions,
      parameterOverrides: f.parameterOverrides,
      activeParameterCount: f.activeParameterCount,
      resetAllParameters: f.resetAllParameters,
      handleNumberParameterChange: f.handleNumberParameterChange,
      handleBooleanParameterChange: f.handleBooleanParameterChange,
      handleTextParameterChange: f.handleTextParameterChange,
      handleSelectParameterChange: f.handleSelectParameterChange,
      handleClearParameter: f.handleClearParameter,
      formatDefaultParameter: f.formatDefaultParameter,
    },
    usage: {
      usageOpen: f.usageOpen,
      onUsageToggle: f.onUsageToggle,
      usage: f.usage,
      contextWindow: f.contextWindow,
      contextConsumed: f.contextConsumed,
      onExportChatHistory: f.onExportChatHistory,
    },
  };
};

describe("TelemetryPanel", () => {
  it("renders headers and close action", () => {
    const props = buildProps({ promptLoading: true });
    render(<TelemetryPanel {...props} />);

    expect(screen.getByText("Run settings")).toBeInTheDocument();
    expect(screen.getByText(/Loading prompt/)).toBeInTheDocument();

    act(() => {
      lastDndProps.onDragStart?.({ active: { id: "systemPrompt" } });
    });

    expect(screen.getByTestId("drag-overlay")).toBeInTheDocument();

    act(() => {
      lastDndProps.onDragEnd?.({
        active: { id: "systemPrompt" },
        over: { id: "usage" },
      });
    });

    expect(props.sections.onSectionOrderChange).toHaveBeenCalled();

    act(() => {
      lastDndProps.onDragEnd?.({
        active: { id: "systemPrompt" },
        over: { id: "systemPrompt" },
      });
    });

    act(() => {
      lastDndProps.onDragEnd?.({ active: { id: "systemPrompt" }, over: null });
    });

    act(() => {
      lastDndProps.onDragCancel?.();
    });

    act(() => {
      lastDndProps.onDragEnd?.({
        active: { id: "systemPrompt" },
        over: { id: "unknown" as RunSettingsSectionKey },
      });
    });

    screen.getByRole("button", { name: "Close run settings" }).click();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders prompt error description", () => {
    const props = buildProps({ promptError: "Error", promptLoading: false });
    render(<TelemetryPanel {...props} />);
    expect(screen.getByText(/Prompt unavailable/)).toBeInTheDocument();
  });

  it("renders dynamic section descriptions", () => {
    const baseOverrides: FlatOverrides = {
      promptSections: [{ id: "base", label: "Base", scope: "base", isCustom: false }],
      selectedToolCollectionIds: ["col-1", "col-2"],
      providerRuleCount: 2,
      currentModelInfo: makeCatalogModel({
        id: "model-1",
        name: "Model A",
        supported_parameters: [],
      }),
      activeParameterCount: 1,
      contextWindow: 120,
      contextConsumed: 30,
      streamingEnabled: false,
    };
    const props = buildProps(baseOverrides);

    const { rerender } = render(<TelemetryPanel {...props} />);

    expect(screen.getByText("1 section ready")).toBeInTheDocument();
    expect(screen.getByText("2 collections active")).toBeInTheDocument();
    expect(screen.getByText("2 routing rules configured")).toBeInTheDocument();
    expect(screen.getByText("1 override active")).toBeInTheDocument();
    expect(screen.getByText("30 / 120 tokens")).toBeInTheDocument();
    expect(screen.getByText("Responses buffered until completion")).toBeInTheDocument();

    rerender(<TelemetryPanel {...buildProps({ ...baseOverrides, activeParameterCount: 2 })} />);
    expect(screen.getByText("2 overrides active")).toBeInTheDocument();
  });

  it("renders singular descriptions and metadata fallbacks", () => {
    const props = buildProps({
      promptSections: [
        { id: "base", label: "Base", scope: "base", isCustom: false },
        { id: "tool", label: "Tool", scope: "collection", isCustom: false },
      ],
      selectedToolCollectionIds: ["col-1"],
      providerRuleCount: 1,
      currentModelInfo: null,
      activeParameterCount: 0,
      contextWindow: 0,
      contextConsumed: 10,
    });

    render(<TelemetryPanel {...props} />);

    expect(screen.getByText("2 sections ready")).toBeInTheDocument();
    expect(screen.getByText("1 collection active")).toBeInTheDocument();
    expect(screen.getByText("1 routing rule configured")).toBeInTheDocument();
    expect(screen.getByText("Load model metadata")).toBeInTheDocument();
    expect(screen.getByText("10 tokens consumed")).toBeInTheDocument();
  });

  it("applies drag styling when dragging", () => {
    mockIsDragging = true;
    render(<TelemetryPanel {...buildProps()} />);

    const dragButton = screen.getByRole("button", { name: /Reorder System prompt/ });
    expect(dragButton.className).toContain("bg-surface-strong");
    mockIsDragging = false;
  });
});
