"use client";

import { ChatStudioHeader } from "@/components/chat-studio/ChatStudioHeader";
import { ChatStudioMessages } from "@/components/chat-studio/ChatStudioMessages";
import { ChatStudioView } from "@/components/chat-studio/ChatStudioView";
import { HistoryPanel } from "@/components/chat-studio/HistoryPanel";
import { PromptEditorOverlay } from "@/components/chat-studio/PromptEditorOverlay";
import { TelemetryPanel } from "@/components/chat-studio/telemetry/TelemetryPanel";

import { markdownComponents } from "./chat-utils";

import type { ChatEntry } from "@/components/chat-studio/chat-types";
import type { useChatStream } from "@/components/chat-studio/hooks/use-chat-stream";
import type { useCollectionTools } from "@/components/chat-studio/hooks/use-collection-tools";
import type { UsePanelControlsResult } from "@/components/chat-studio/hooks/use-panel-controls";
import type { usePromptEditor } from "@/components/chat-studio/hooks/use-prompt-editor";
import type {
  TelemetryCollectionsProps,
  TelemetryModelProps,
  TelemetryParametersProps,
  TelemetryPromptsProps,
  TelemetryProviderProps,
  TelemetrySectionsProps,
  TelemetryStreamingProps,
  TelemetryUsageProps,
} from "@/components/chat-studio/types";
import type { ChatSession, ReasoningTraceSegment } from "@/lib/types";
import type { RefObject, UIEventHandler } from "react";

type ChatStream = ReturnType<typeof useChatStream>;
type CollectionTools = ReturnType<typeof useCollectionTools>;
type PromptEditor = ReturnType<typeof usePromptEditor>;

export interface ChatStudioTelemetryGroups {
  sections: TelemetrySectionsProps;
  prompts: TelemetryPromptsProps;
  collections: TelemetryCollectionsProps;
  streaming: TelemetryStreamingProps;
  model: TelemetryModelProps;
  provider: TelemetryProviderProps;
  parameters: TelemetryParametersProps;
  usage: TelemetryUsageProps;
}

export interface ChatStudioPanelsProps {
  // Shell
  status: string | null;
  onStatusDismiss: () => void;
  loading: boolean;
  panel: UsePanelControlsResult;
  // Grouped hook results
  chatStream: ChatStream;
  collectionTools: CollectionTools;
  promptEditor: PromptEditor;
  telemetry: ChatStudioTelemetryGroups;
  // Header / new chat / history
  currentModelLabel: string;
  onStartNewChat: () => void;
  onTimelineModelSelect: () => void;
  deletingSessionId: string | null;
  sessions: ChatSession[];
  onDeleteSession: (sessionId: string) => void;
  // Messages panel wiring
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  showFollowButton: boolean;
  onFollow: () => void;
  selectedSessionId: string | null;
  activeSession: ChatSession | null;
  branchedFromSession: ChatSession | null;
  branchedSessionOriginRef: React.MutableRefObject<Map<string, "edit" | "manual">>;
  chatEntryMap: Map<string, ChatEntry>;
  chatEntryOrder: string[];
  overrideSections: Array<{ id: string; label: string }>;
  liveReasoningDisplaySegments: ReasoningTraceSegment[];
  hasLiveText: boolean;
  showStreamingBubble: boolean;
  shouldShowStreamingReasoningBubble: boolean;
  // Timeline handlers
  onNavigateToSession: (sessionId: string) => void;
  onEditStart: (messageId: string, content: string) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
  onRetryAssistant: (messageId: string) => void;
  onBranchMessage: (messageId: string) => void;
  // Input
  sending: boolean;
  isStopping: boolean;
  editingMessageId: string | null;
  editingDraft: string;
  onEditChange: (value: string) => void;
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  chatPromptRef: RefObject<HTMLTextAreaElement | null>;
  chatInputPlaceholder: string;
}

/**
 * Presentational assembly of ChatStudio's five panels (history, telemetry, header,
 * message timeline + input, prompt-editor overlay) and the responsive view shell.
 * Holds no state — every value is passed in by the ChatStudio orchestrator.
 */
export function ChatStudioPanels(props: ChatStudioPanelsProps) {
  const {
    status,
    onStatusDismiss,
    loading,
    panel,
    chatStream,
    collectionTools,
    promptEditor,
    telemetry,
    currentModelLabel,
    onStartNewChat,
    onTimelineModelSelect,
    deletingSessionId,
    messagesContainerRef,
    endRef,
    onScroll,
    showFollowButton,
    onFollow,
    selectedSessionId,
    activeSession,
    branchedFromSession,
    branchedSessionOriginRef,
    chatEntryMap,
    chatEntryOrder,
    overrideSections,
    liveReasoningDisplaySegments,
    hasLiveText,
    showStreamingBubble,
    shouldShowStreamingReasoningBubble,
    onNavigateToSession,
    onEditStart,
    onEditCancel,
    onEditSubmit,
    onRetryAssistant,
    onBranchMessage,
    sending,
    isStopping,
    editingMessageId,
    editingDraft,
    onEditChange,
    draft,
    setDraft,
    onSend,
    onStop,
    chatPromptRef,
    chatInputPlaceholder,
    sessions,
    onDeleteSession,
  } = props;

  const historyPanel = (
    <HistoryPanel
      collections={collectionTools.collections}
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      onSelect={onNavigateToSession}
      onNewChat={onStartNewChat}
      filterCollectionIds={collectionTools.historyFilterCollectionIds}
      filterIncludeUnassigned={collectionTools.historyFilterIncludeUnassigned}
      onFilterChange={collectionTools.handleHistoryFilterChange}
      onDelete={onDeleteSession}
      deletingSessionId={deletingSessionId}
      onClose={panel.handleHistoryClose}
    />
  );

  const telemetryPanel = (
    <TelemetryPanel
      onClose={panel.handleTelemetryClose}
      sections={telemetry.sections}
      prompts={telemetry.prompts}
      collections={telemetry.collections}
      streaming={telemetry.streaming}
      model={telemetry.model}
      provider={telemetry.provider}
      parameters={telemetry.parameters}
      usage={telemetry.usage}
    />
  );

  const header = (
    <ChatStudioHeader
      collectionLabel={collectionTools.collectionLabel}
      collectionMetaLabel={collectionTools.collectionMetaLabel}
      currentModelLabel={currentModelLabel}
      showNewChatButton={!panel.historyOpen}
      onModelSelect={onTimelineModelSelect}
      onNewChat={onStartNewChat}
    />
  );

  const messagesPanel = (
    <ChatStudioMessages
      messagesContainerRef={messagesContainerRef}
      endRef={endRef}
      onScroll={onScroll}
      showFollowButton={showFollowButton}
      onFollow={onFollow}
      timelineProps={{
        modelLabel: currentModelLabel,
        onModelSelect: onTimelineModelSelect,
        chatEntryOrder,
        chatEntryMap,
        finalStreamAssistantId: chatStream.finalStreamAssistantId,
        streamEntryKeyMap: chatStream.streamEntryKeyMap,
        liveToolEvents: chatStream.liveToolEvents,
        selectedSessionId,
        sending,
        editingMessageId,
        editingDraft,
        onEditChange,
        onEditStart,
        onEditCancel,
        onEditSubmit,
        onRetryAssistant,
        onBranchMessage,
        markdownComponents,
        overrideSections,
        onOverrideSelect: panel.handleOverrideSelect,
        liveResponse: chatStream.liveResponse,
        hasLiveText,
        liveResponseAnimationKey: chatStream.liveResponseAnimationKey,
        activeStreamEntryKey: chatStream.activeStreamEntryKey,
        shouldShowStreamingReasoningBubble,
        liveReasoningAnimationKey: chatStream.liveReasoningAnimationKey,
        liveReasoningBlocks: chatStream.liveReasoningBlocks,
        liveReasoningPhase: chatStream.liveReasoningPhase,
        liveToolOrder: chatStream.liveToolOrder,
        liveToolPhaseById: chatStream.liveToolPhaseById,
        liveReasoningDisplaySegments,
        showStreamingBubble,
        branchedFromSessionId: activeSession?.branched_from_session_id ?? null,
        branchedFromSessionTitle: branchedFromSession?.title ?? null,
        branchedFromMessageId: activeSession?.branched_from_message_id ?? null,
        // Reading a ref during render to look up per-session metadata computed on a
        // prior navigation (not written during this render); React's "recompute during
        // render" pattern for derived, session-keyed history. See Task 13 brief.
        branchedFromOrigin: selectedSessionId
          ? // eslint-disable-next-line react-hooks/refs
            (branchedSessionOriginRef.current.get(selectedSessionId) ?? "manual")
          : "manual",
        onNavigateToSession,
      }}
      inputProps={{
        draft,
        setDraft,
        sending,
        isStopping,
        onSend,
        onStop,
        inputRef: chatPromptRef,
        placeholder: chatInputPlaceholder,
      }}
    />
  );

  const promptEditorOverlay = (
    <PromptEditorOverlay
      isOpen={promptEditor.promptEditorOpen}
      onClose={promptEditor.handlePromptEditorClose}
      sections={promptEditor.promptSections}
      activeSectionId={promptEditor.activePromptSectionId}
      onSelectSection={promptEditor.handlePromptSectionSelect}
      onDraftChange={promptEditor.handlePromptDraftChange}
      promptPreviewMarkdown={promptEditor.promptPreviewMarkdown}
      onSave={promptEditor.handlePromptSave}
      onReset={promptEditor.handlePromptReset}
      onInsertVariable={promptEditor.handleInsertPromptVariable}
      inputRef={promptEditor.promptEditorRef}
      markdownComponents={markdownComponents}
    />
  );

  return (
    <ChatStudioView
      status={status}
      onStatusDismiss={onStatusDismiss}
      loading={loading}
      chatPanelRef={panel.chatPanelRef}
      isOverlayMode={panel.isOverlayMode}
      historyOpen={panel.historyOpen}
      telemetryOpen={panel.telemetryOpen}
      onOpenHistory={panel.handleHistoryOpen}
      onCloseHistory={panel.handleHistoryClose}
      onOpenTelemetry={panel.handleTelemetryOpen}
      onCloseTelemetry={panel.handleTelemetryClose}
      header={header}
      messagesPanel={messagesPanel}
      historyPanel={historyPanel}
      telemetryPanel={telemetryPanel}
      promptEditor={promptEditorOverlay}
    />
  );
}
