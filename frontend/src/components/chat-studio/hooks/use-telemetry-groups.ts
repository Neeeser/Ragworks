"use client";

import { useCallback, useMemo } from "react";

import {
  DEFAULT_STREAMING_ENABLED,
  TELEMETRY_SECTION_IDS,
} from "@/components/chat-studio/chat-constants";
import { sortMessagesChronologically } from "@/components/chat-studio/chat-entry-helpers";
import { sanitizeFileName } from "@/components/chat-studio/chat-utils";

import type { useCollectionTools } from "@/components/chat-studio/hooks/use-collection-tools";
import type { UsePanelControlsResult } from "@/components/chat-studio/hooks/use-panel-controls";
import type { usePromptEditor } from "@/components/chat-studio/hooks/use-prompt-editor";
import type {
  TelemetryCollectionsProps,
  TelemetryPromptsProps,
  TelemetrySectionsProps,
  TelemetryStreamingProps,
  TelemetryUsageProps,
} from "@/components/chat-studio/types";
import type { ChatMessage, ChatSession, RunSettingsSectionKey, UsageBreakdown } from "@/lib/types";

type CollectionTools = ReturnType<typeof useCollectionTools>;
type PromptEditor = ReturnType<typeof usePromptEditor>;

export interface UseTelemetryGroupsParams {
  runSettingsOrder: RunSettingsSectionKey[];
  setRunSettingsOrder: (order: RunSettingsSectionKey[]) => void;
  promptEditor: PromptEditor;
  collectionTools: CollectionTools;
  panel: UsePanelControlsResult;
  pineconeConfigured: boolean;
  streamingEnabled: boolean;
  setStreamingEnabled: (enabled: boolean) => void;
  usage: UsageBreakdown | null;
  contextConsumed: number;
  messages: ChatMessage[];
  sessions: ChatSession[];
  selectedSessionId: string | null;
  providerRuleCount: number;
  activeParameterCount: number;
}

export interface UseTelemetryGroupsResult {
  telemetrySections: TelemetrySectionsProps;
  telemetryPrompts: TelemetryPromptsProps;
  telemetryCollections: TelemetryCollectionsProps;
  telemetryStreaming: TelemetryStreamingProps;
  telemetryUsage: TelemetryUsageProps;
  overrideSections: Array<{ id: string; label: string }>;
}

/**
 * Builds the memoised TelemetryPanel group props for the context/output sections
 * (sections order, system prompt, collection tools + vitals, streaming, usage) plus the
 * timeline's override-badge list. Each group is a stable object so the memoised panel
 * only re-renders when its own inputs change.
 */
export function useTelemetryGroups(params: UseTelemetryGroupsParams): UseTelemetryGroupsResult {
  const {
    runSettingsOrder,
    setRunSettingsOrder,
    promptEditor,
    collectionTools,
    panel,
    pineconeConfigured,
    streamingEnabled,
    setStreamingEnabled,
    usage,
    contextConsumed,
    messages,
    sessions,
    selectedSessionId,
    providerRuleCount,
    activeParameterCount,
  } = params;

  const {
    basePromptDetails,
    promptSectionsSummary,
    promptPreviewMarkdown,
    promptLoading,
    promptError,
    promptGeneratedAt,
    handlePromptEditorOpen,
  } = promptEditor;

  const {
    collections,
    selectedToolCollectionIds,
    toggleToolCollection,
    clearToolCollections,
    collectionsLoading,
    collectionsError,
    primaryCollection,
    documentCount,
    contextWindow,
  } = collectionTools;

  const {
    systemPromptOpen,
    toggleSystemPrompt,
    collectionToolsOpen,
    toggleCollectionTools,
    vitalsOpen,
    toggleVitals,
    streamingOptionsOpen,
    toggleStreamingOptions,
    usageOpen,
    toggleUsage,
  } = panel;

  const handleExportChatHistory = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }
    const sortedMessages = sortMessagesChronologically(messages);
    const payload = { messages: sortedMessages };
    const titleSegment = sanitizeFileName(
      sessions.find((session) => session.id === selectedSessionId)?.title ?? null,
    );
    const idSegment = sanitizeFileName(selectedSessionId ?? null);
    const fallbackSegment = titleSegment || idSegment || sanitizeFileName(new Date().toISOString());
    const fileName = `chat-history-${fallbackSegment || Date.now().toString(36)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [messages, selectedSessionId, sessions]);

  const telemetrySections = useMemo<TelemetrySectionsProps>(
    () => ({
      sectionIds: TELEMETRY_SECTION_IDS,
      sectionOrder: runSettingsOrder,
      onSectionOrderChange: setRunSettingsOrder,
    }),
    [runSettingsOrder, setRunSettingsOrder],
  );

  const telemetryPrompts = useMemo<TelemetryPromptsProps>(
    () => ({
      systemPromptCustom: Boolean(basePromptDetails?.is_custom),
      promptSections: promptSectionsSummary,
      promptPreviewMarkdown,
      promptLoading,
      promptError,
      promptGeneratedAt,
      systemPromptOpen,
      onSystemPromptToggle: toggleSystemPrompt,
      onPromptEdit: handlePromptEditorOpen,
    }),
    [
      basePromptDetails?.is_custom,
      handlePromptEditorOpen,
      promptError,
      promptGeneratedAt,
      promptLoading,
      promptPreviewMarkdown,
      promptSectionsSummary,
      systemPromptOpen,
      toggleSystemPrompt,
    ],
  );

  const telemetryCollections = useMemo<TelemetryCollectionsProps>(
    () => ({
      collections,
      selectedToolCollectionIds,
      onToggleToolCollection: toggleToolCollection,
      onClearToolCollections: clearToolCollections,
      collectionsLoading,
      collectionsError,
      pineconeConfigured,
      collectionToolsOpen,
      onCollectionToolsToggle: toggleCollectionTools,
      vitalsOpen,
      onVitalsToggle: toggleVitals,
      collection: primaryCollection,
      collectionCount: selectedToolCollectionIds.length,
      documentCount,
    }),
    [
      clearToolCollections,
      collectionToolsOpen,
      collections,
      collectionsError,
      collectionsLoading,
      documentCount,
      pineconeConfigured,
      primaryCollection,
      selectedToolCollectionIds,
      toggleCollectionTools,
      toggleToolCollection,
      toggleVitals,
      vitalsOpen,
    ],
  );

  const telemetryStreaming = useMemo<TelemetryStreamingProps>(
    () => ({
      streamingOptionsOpen,
      onStreamingOptionsToggle: toggleStreamingOptions,
      streamingEnabled,
      onStreamingToggle: setStreamingEnabled,
    }),
    [setStreamingEnabled, streamingEnabled, streamingOptionsOpen, toggleStreamingOptions],
  );

  const telemetryUsage = useMemo<TelemetryUsageProps>(
    () => ({
      usageOpen,
      onUsageToggle: toggleUsage,
      usage,
      contextWindow,
      contextConsumed,
      onExportChatHistory: handleExportChatHistory,
    }),
    [contextConsumed, contextWindow, handleExportChatHistory, toggleUsage, usage, usageOpen],
  );

  const overrideSections = useMemo(() => {
    const sections: Array<{ id: string; label: string }> = [];
    if (basePromptDetails?.is_custom) {
      sections.push({ id: TELEMETRY_SECTION_IDS.systemPrompt, label: "System prompt" });
    }
    if (selectedToolCollectionIds.length > 0) {
      sections.push({ id: TELEMETRY_SECTION_IDS.collectionTools, label: "Collection tools" });
    }
    if (streamingEnabled !== DEFAULT_STREAMING_ENABLED) {
      sections.push({ id: TELEMETRY_SECTION_IDS.streaming, label: "Streaming" });
    }
    if (providerRuleCount > 0) {
      sections.push({ id: TELEMETRY_SECTION_IDS.providerRouting, label: "Provider routing" });
    }
    if (activeParameterCount > 0) {
      sections.push({ id: TELEMETRY_SECTION_IDS.modelParameters, label: "Model parameters" });
    }
    return sections;
  }, [
    activeParameterCount,
    basePromptDetails?.is_custom,
    providerRuleCount,
    selectedToolCollectionIds.length,
    streamingEnabled,
  ]);

  return {
    telemetrySections,
    telemetryPrompts,
    telemetryCollections,
    telemetryStreaming,
    telemetryUsage,
    overrideSections,
  };
}
