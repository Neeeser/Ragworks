"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

import { ChatStudioPanels } from "@/components/chat-studio/ChatStudioPanels";
import { useChatMutation } from "@/components/chat-studio/hooks/messaging/use-chat-mutation";
import { useChatStream } from "@/components/chat-studio/hooks/messaging/use-chat-stream";
import { useMessageEdit } from "@/components/chat-studio/hooks/messaging/use-message-edit";
import { useChatEntries } from "@/components/chat-studio/hooks/session/use-chat-entries";
import { useChatSessionRouting } from "@/components/chat-studio/hooks/session/use-chat-session-routing";
import { useSessionHistoryPolling } from "@/components/chat-studio/hooks/session/use-session-history-polling";
import { useSessionLifecycle } from "@/components/chat-studio/hooks/session/use-session-lifecycle";
import { useSessionMessages } from "@/components/chat-studio/hooks/session/use-session-messages";
import { useCollectionTools } from "@/components/chat-studio/hooks/settings/use-collection-tools";
import { useModelCatalog } from "@/components/chat-studio/hooks/settings/use-model-catalog";
import { useModelParameters } from "@/components/chat-studio/hooks/settings/use-model-parameters";
import { usePromptEditor } from "@/components/chat-studio/hooks/settings/use-prompt-editor";
import { useProviderPreferences } from "@/components/chat-studio/hooks/settings/use-provider-preferences";
import { useRunSettingsOrder } from "@/components/chat-studio/hooks/settings/use-run-settings-order";
import { useTelemetryGroups } from "@/components/chat-studio/hooks/settings/use-telemetry-groups";
import { useTelemetryModelGroups } from "@/components/chat-studio/hooks/settings/use-telemetry-model-groups";
import { useAutoScroll } from "@/components/chat-studio/hooks/use-auto-scroll";
import { useChatStudioState } from "@/components/chat-studio/hooks/use-chat-studio-state";
import { usePanelControls } from "@/components/chat-studio/hooks/use-panel-controls";
import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
  TELEMETRY_SECTION_IDS,
} from "@/components/chat-studio/lib/chat-constants";
import { useAuth } from "@/providers/auth-provider";

export function ChatStudio() {
  const {
    activeSessionId,
    sessionIdParam,
    urlCollectionsValue,
    buildChatUrl,
    navigateToChat,
    replaceUrl,
  } = useChatSessionRouting();
  const { token, user, loading: authLoading, refreshProfile } = useAuth();
  const selectedSessionId = activeSessionId;

  const state = useChatStudioState();
  const {
    sessions,
    setSessions,
    messages,
    draft,
    status,
    loading,
    sending,
    isStopping,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    setDraft,
    setStatus,
    usage,
    contextConsumed,
    streamingEnabled,
    setStreamingEnabled,
    activeModelId,
    setActiveModelId,
    deletingSessionId,
    branchedSessionOriginRef,
  } = state;

  const chatStream = useChatStream();
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);

  const authToken = token ?? "";
  const openrouterConfigured = Boolean(!authLoading && user?.openrouter_configured);
  const pineconeConfigured = Boolean(!authLoading && user?.pinecone_configured);

  const {
    chatEntryMap,
    chatEntryOrder,
    syncMessages,
    deriveToolTraces,
    messageOrderRef,
    nextMessageOrderRef,
  } = useChatEntries({
    messages,
    setMessages: state.setMessages,
    optimisticMessages: state.optimisticMessages,
    toolTraces: state.toolTraces,
    selectedSessionId,
    resetStreamKeys: chatStream.resetStreamKeys,
  });

  const {
    autoScrollEnabled,
    setAutoScrollEnabled,
    endRef,
    messagesContainerRef,
    scrollAnimationFrameRef,
    handleScroll,
    handleReenableAutoScroll,
  } = useAutoScroll({
    selectedSessionId,
    chatEntryOrder,
    liveResponse: chatStream.liveResponse,
    liveReasoningSegments: chatStream.liveReasoningSegments,
  });

  const hasLiveText = chatStream.liveResponse.trim().length > 0;
  const hasLiveReasoning = chatStream.liveReasoningSegments.length > 0;
  const showStreamingBubble =
    streamingEnabled && (chatStream.isStreamingResponse || hasLiveText || hasLiveReasoning);
  const liveReasoningDisplaySegments = hasLiveReasoning
    ? chatStream.liveReasoningSegments
    : chatStream.persistedLiveReasoningSegments;
  const hasDisplayedLiveReasoning =
    chatStream.liveReasoningBlocks.length > 0 || liveReasoningDisplaySegments.length > 0;
  const shouldShowStreamingReasoningBubble =
    Boolean(chatStream.activeStreamEntryKey) && hasDisplayedLiveReasoning;

  // Computed fresh every render rather than memoised on selectedSessionId alone, so it
  // reflects the current pending set even when the write path mutates it in place.
  const isPendingSession = selectedSessionId
    ? state.pendingSessionIdsRef.current.has(selectedSessionId)
    : false;

  const runSettings = useRunSettingsOrder({ authToken, user, refreshProfile, onError: setStatus });

  const polling = useSessionHistoryPolling({
    authToken,
    selectedSessionId,
    isStreamingResponseRef: chatStream.isStreamingResponseRef,
    syncMessages,
    setToolTraces: state.setToolTraces,
    setUsage: state.setUsage,
  });

  const collectionTools = useCollectionTools({
    authToken,
    authLoading,
    pineconeConfigured,
    selectedSessionId,
    urlCollectionsValue,
    setSessions,
  });
  const { selectedToolCollectionIds } = collectionTools;
  const toolsEnabled = selectedToolCollectionIds.length > 0;

  const modelCatalog = useModelCatalog({
    authToken,
    authLoading,
    openrouterConfigured,
    activeModelId,
    toolsEnabled,
  });

  const modelParameters = useModelParameters({
    currentModelInfo: modelCatalog.currentModelInfo,
    modelCatalog: modelCatalog.modelCatalog,
    supportedParameterKeys: modelCatalog.supportedParameterKeys,
  });

  const providerPreferences = useProviderPreferences({
    authToken,
    authLoading,
    openrouterConfigured,
    providerModelSlug: modelCatalog.providerModelSlug,
  });

  const promptEditor = usePromptEditor({
    authToken,
    authLoading,
    selectedToolCollectionIds,
    selectedToolCollections: collectionTools.selectedToolCollections,
  });

  const panel = usePanelControls({ setLoading: state.setLoading });

  const sortSessions = useCallback((items: typeof sessions) => {
    const pendingIds = state.pendingSessionIdsRef.current;
    return [...items].sort((a, b) => {
      const aPending = pendingIds.has(a.id);
      const bPending = pendingIds.has(b.id);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { activeSession, branchedFromSession } = useSessionLifecycle({
    ...state,
    authLoading,
    authToken,
    openrouterConfigured,
    user,
    selectedSessionId,
    sessionIdParam,
    isPendingSession,
    replaceUrl,
    buildChatUrl,
    selectedToolCollectionIds,
    historyFilterActive: collectionTools.historyFilterActive,
    historyFilterCollectionIds: collectionTools.historyFilterCollectionIds,
    historyFilterIncludeUnassigned: collectionTools.historyFilterIncludeUnassigned,
    resolveValidToolCollectionIds: collectionTools.resolveValidToolCollectionIds,
    setSelectedToolCollectionIds: collectionTools.setSelectedToolCollectionIds,
    setParameterOverrides: modelParameters.setParameterOverrides,
    setProviderForm: providerPreferences.setProviderForm,
    sortSessions,
  });

  useSessionMessages({
    ...state,
    authToken,
    selectedSessionId,
    messageOrderRef,
    syncMessages,
    deriveToolTraces,
    pruneLiveToolEvents: chatStream.pruneLiveToolEvents,
  });

  const { handleEditStart, handleEditCancel } = useMessageEdit({
    editingMessageId,
    setEditingMessageId: state.setEditingMessageId,
    setEditingDraft,
    autoScrollEnabled,
    setAutoScrollEnabled,
    messagesContainerRef,
    scrollAnimationFrameRef,
  });

  const {
    handleSend,
    handleStopGeneration,
    handleEditSubmit,
    handleRetryAssistant,
    handleBranchMessage,
    handleStartNewChat,
    handleDeleteSession,
  } = useChatMutation({
    ...state,
    authToken,
    user,
    toolsEnabled,
    pineconeConfigured,
    activeModelId,
    buildParameterPayload: modelParameters.buildParameterPayload,
    providerRuleCount: providerPreferences.providerRuleCount,
    providerPayload: providerPreferences.providerPayload,
    parameterOverrides: modelParameters.parameterOverrides,
    providerForm: providerPreferences.providerForm,
    selectedSessionId,
    navigateToChat,
    selectedToolCollectionIds,
    setSelectedToolCollectionIds: collectionTools.setSelectedToolCollectionIds,
    contextWindow: collectionTools.contextWindow,
    setContextWindow: collectionTools.setContextWindow,
    toolCollectionsDirtyRef: collectionTools.toolCollectionsDirtyRef,
    chatStream,
    startProgressPolling: polling.startProgressPolling,
    stopProgressPolling: polling.stopProgressPolling,
    setParameterOverrides: modelParameters.setParameterOverrides,
    setProviderForm: providerPreferences.setProviderForm,
    messageOrderRef,
    nextMessageOrderRef,
    syncMessages,
    deriveToolTraces,
    sortSessions,
  });

  const {
    telemetrySections,
    telemetryPrompts,
    telemetryCollections,
    telemetryStreaming,
    telemetryUsage,
    overrideSections,
  } = useTelemetryGroups({
    runSettingsOrder: runSettings.runSettingsOrder,
    setRunSettingsOrder: runSettings.setRunSettingsOrder,
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
    providerRuleCount: providerPreferences.providerRuleCount,
    activeParameterCount: modelParameters.activeParameterCount,
  });

  const { telemetryModel, telemetryProvider, telemetryParameters } = useTelemetryModelGroups({
    modelCatalog,
    modelParameters,
    providerPreferences,
    panel,
    toolsEnabled,
    setActiveModelId,
  });

  const currentModelLabel = modelCatalog.currentModelInfo?.name || activeModelId || "Select model";

  const handleNavigateToSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((item) => item.id === sessionId);
      navigateToChat(sessionId, session?.tool_collection_ids ?? []);
    },
    [navigateToChat, sessions],
  );

  const handleTimelineModelSelect = useCallback(
    () => panel.handleOverrideSelect(TELEMETRY_SECTION_IDS.modelRouting),
    [panel],
  );

  const showFollowButton =
    !autoScrollEnabled && (chatEntryOrder.length > 0 || hasLiveText || hasDisplayedLiveReasoning);

  useLayoutEffect(() => {
    const textarea = chatPromptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const fullHeight = textarea.scrollHeight;
    const clampedHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT,
      Math.min(fullHeight, CHAT_INPUT_MAX_HEIGHT),
    );
    textarea.style.height = `${clampedHeight}px`;
    textarea.style.overflowY = fullHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  const chatInputPlaceholder = toolsEnabled
    ? "Ask about the selected collections…"
    : "Ask anything…";

  return (
    <ChatStudioPanels
      status={status}
      onStatusDismiss={() => setStatus(null)}
      loading={loading}
      panel={panel}
      chatStream={chatStream}
      collectionTools={collectionTools}
      promptEditor={promptEditor}
      telemetry={{
        sections: telemetrySections,
        prompts: telemetryPrompts,
        collections: telemetryCollections,
        streaming: telemetryStreaming,
        model: telemetryModel,
        provider: telemetryProvider,
        parameters: telemetryParameters,
        usage: telemetryUsage,
      }}
      currentModelLabel={currentModelLabel}
      onStartNewChat={handleStartNewChat}
      onTimelineModelSelect={handleTimelineModelSelect}
      deletingSessionId={deletingSessionId}
      sessions={sessions}
      onDeleteSession={handleDeleteSession}
      messagesContainerRef={messagesContainerRef}
      endRef={endRef}
      onScroll={handleScroll}
      showFollowButton={showFollowButton}
      onFollow={handleReenableAutoScroll}
      selectedSessionId={selectedSessionId}
      activeSession={activeSession}
      branchedFromSession={branchedFromSession}
      branchedSessionOriginRef={branchedSessionOriginRef}
      chatEntryMap={chatEntryMap}
      chatEntryOrder={chatEntryOrder}
      overrideSections={overrideSections}
      liveReasoningDisplaySegments={liveReasoningDisplaySegments}
      hasLiveText={hasLiveText}
      showStreamingBubble={showStreamingBubble}
      shouldShowStreamingReasoningBubble={shouldShowStreamingReasoningBubble}
      onNavigateToSession={handleNavigateToSession}
      onEditStart={handleEditStart}
      onEditCancel={handleEditCancel}
      onEditSubmit={handleEditSubmit}
      onRetryAssistant={handleRetryAssistant}
      onBranchMessage={handleBranchMessage}
      sending={sending}
      isStopping={isStopping}
      editingMessageId={editingMessageId}
      editingDraft={editingDraft}
      onEditChange={setEditingDraft}
      draft={draft}
      setDraft={setDraft}
      onSend={handleSend}
      onStop={handleStopGeneration}
      chatPromptRef={chatPromptRef}
      chatInputPlaceholder={chatInputPlaceholder}
    />
  );
}
