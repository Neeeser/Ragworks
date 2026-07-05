"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
  DEFAULT_STREAMING_ENABLED,
  PINECONE_KEY_REQUIRED_MESSAGE,
  TELEMETRY_SECTION_IDS,
} from "@/components/chat-studio/chat-constants";
import {
  areArraysEqual,
  attachUsageToLastAssistantMessage,
  buildChatEntries,
  calculateSessionUsage,
  createDefaultProviderForm,
  createProviderFormFromPreferences,
  deriveToolTracesFromMessages,
  ensureMessageOrder,
  generateClientMessageId,
  generateClientSessionId,
  isOptimisticDuplicate,
  mergeMessageHistory,
  pruneHistoryForEdit,
  sortMessagesChronologically,
} from "@/components/chat-studio/chat-helpers";
import { ChatStudioHeader } from "@/components/chat-studio/ChatStudioHeader";
import { ChatStudioMessages } from "@/components/chat-studio/ChatStudioMessages";
import { ChatStudioView } from "@/components/chat-studio/ChatStudioView";
import { useAutoScroll } from "@/components/chat-studio/hooks/use-auto-scroll";
import { useChatSessionRouting } from "@/components/chat-studio/hooks/use-chat-session-routing";
import { useChatStream } from "@/components/chat-studio/hooks/use-chat-stream";
import { useCollectionTools } from "@/components/chat-studio/hooks/use-collection-tools";
import { useModelCatalog } from "@/components/chat-studio/hooks/use-model-catalog";
import { useModelParameters } from "@/components/chat-studio/hooks/use-model-parameters";
import { usePromptEditor } from "@/components/chat-studio/hooks/use-prompt-editor";
import { useProviderPreferences } from "@/components/chat-studio/hooks/use-provider-preferences";
import { useRunSettingsOrder } from "@/components/chat-studio/hooks/use-run-settings-order";
import { useSessionHistoryPolling } from "@/components/chat-studio/hooks/use-session-history-polling";
import { HistoryPanel } from "@/components/chat-studio/HistoryPanel";
import { PromptEditorOverlay } from "@/components/chat-studio/PromptEditorOverlay";
import { TelemetryPanel } from "@/components/chat-studio/telemetry/TelemetryPanel";
import { formatToolLabel } from "@/components/chat-studio/Tooling";
import {
  branchChatSession,
  chat,
  deleteChatSession,
  getChatHistory,
  listChatSessions,
  streamChat,
} from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import { markdownComponents, sanitizeFileName } from "./chat-utils";

import type { ChatEntry } from "./chat-types";
import type { ProviderFormState } from "@/components/chat-studio/types";
import type { ParameterOverrides } from "@/lib/chat-parameters";
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
  ProviderPreferences,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from "@/lib/types";

const HISTORY_PANEL_WIDTH_PX = 288;
const TELEMETRY_PANEL_WIDTH_PX = 416;
const MIN_CENTER_PANEL_WIDTH_PX = 720;
const OVERLAY_TRIGGER_WIDTH_PX =
  HISTORY_PANEL_WIDTH_PX + TELEMETRY_PANEL_WIDTH_PX + MIN_CENTER_PANEL_WIDTH_PX;

const usePersistentToggle = (key: string, defaultValue: boolean) => {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") {
      return defaultValue;
    }
    const stored = window.localStorage.getItem(key);
    return stored === null ? defaultValue : stored === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(key, value ? "true" : "false");
  }, [key, value]);

  return [value, setValue] as const;
};

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
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const selectedSessionId = activeSessionId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolCallTrace[]>([]);
  const [chatEntryOrder, setChatEntryOrder] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.sessionStorage.getItem("chatStudio.loaded") !== "true";
  });
  const [sending, setSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const editScrollSnapshotRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const editAutoScrollRef = useRef<boolean | null>(null);
  const branchedSessionOriginRef = useRef(new Map<string, "edit" | "manual">());
  const skipHistoryFetchSessionRef = useRef<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = usePersistentToggle("chat.historyOpen", true);
  const [telemetryOpen, setTelemetryOpen] = usePersistentToggle("chat.telemetryOpen", true);
  const [modelSelectorOpen, setModelSelectorOpen] = usePersistentToggle(
    "chat.telemetry.modelsOpen",
    true,
  );
  const [systemPromptOpen, setSystemPromptOpen] = usePersistentToggle(
    "chat.telemetry.promptOpen",
    true,
  );
  const [collectionToolsOpen, setCollectionToolsOpen] = usePersistentToggle(
    "chat.telemetry.toolsOpen",
    true,
  );
  const [vitalsOpen, setVitalsOpen] = usePersistentToggle("chat.telemetry.vitalsOpen", true);
  const [usageOpen, setUsageOpen] = usePersistentToggle("chat.telemetry.usageOpen", true);
  const [modelParametersOpen, setModelParametersOpen] = usePersistentToggle(
    "chat.telemetry.parametersOpen",
    true,
  );
  const [providerPreferencesOpen, setProviderPreferencesOpen] = usePersistentToggle(
    "chat.telemetry.providersOpen",
    true,
  );
  const [streamingOptionsOpen, setStreamingOptionsOpen] = usePersistentToggle(
    "chat.telemetry.streamingOpen",
    true,
  );
  const [streamingEnabled, setStreamingEnabled] = useState(DEFAULT_STREAMING_ENABLED);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const previousModelIdRef = useRef<string | null>(null);
  const applyNewChatDefaultsRef = useRef(true);
  const {
    liveResponse,
    isStreamingResponse,
    liveReasoningSegments,
    liveReasoningBlocks,
    liveReasoningPhase,
    persistedLiveReasoningSegments,
    activeStreamEntryKey,
    finalStreamAssistantId,
    streamEntryKeyMap,
    liveToolEvents,
    liveToolOrder,
    liveToolPhaseById,
    liveResponseAnimationKey,
    liveReasoningAnimationKey,
    isStreamingResponseRef,
    reset: resetChatStream,
    resetLiveMessage,
    beginMutation,
    beginStream,
    handleToken,
    handleReasoning,
    handleToolCall,
    handleToolResult,
    completeStream,
    failStream,
    resetStreamKeys,
    pruneLiveToolEvents,
  } = useChatStream();
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    if (typeof window === "undefined") {
      return 0;
    }
    return window.innerWidth;
  });
  const isOverlayMode = chatPanelWidth > 0 && chatPanelWidth < OVERLAY_TRIGGER_WIDTH_PX;
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
    liveResponse,
    liveReasoningSegments,
  });
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());
  const newChatDefaultsRef = useRef<{
    activeModelId: string | null;
    parameterOverrides: ParameterOverrides;
    providerForm: ProviderFormState;
    streamingEnabled: boolean;
    toolCollectionIds: string[];
  } | null>(null);
  const chatHydrationPendingRef = useRef(false);
  const reasoningCacheRef = useRef<Map<string, ReasoningTraceSegment[]>>(new Map());
  const messageOrderRef = useRef<Map<string, number>>(new Map());
  const nextMessageOrderRef = useRef(1);

  const hasLiveText = liveResponse.trim().length > 0;
  const hasLiveReasoning = liveReasoningSegments.length > 0;
  const showStreamingBubble =
    streamingEnabled && (isStreamingResponse || hasLiveText || hasLiveReasoning);
  const liveReasoningDisplaySegments = hasLiveReasoning
    ? liveReasoningSegments
    : persistedLiveReasoningSegments;
  const hasDisplayedLiveReasoning =
    liveReasoningBlocks.length > 0 || liveReasoningDisplaySegments.length > 0;
  const shouldShowStreamingReasoningBubble =
    Boolean(activeStreamEntryKey) && hasDisplayedLiveReasoning;

  const isPendingSession = useMemo(() => {
    if (!selectedSessionId) {
      return false;
    }
    return pendingSessionIdsRef.current.has(selectedSessionId);
  }, [selectedSessionId]);

  const syncMessages = useCallback(
    (
      incoming: ChatMessage[],
      {
        hydrate = false,
        resetStreamKeys: shouldResetStreamKeys = false,
      }: { hydrate?: boolean; resetStreamKeys?: boolean } = {},
    ) => {
      setMessages((previousMessages) => {
        const sortedIncoming = sortMessagesChronologically(incoming);
        const next = hydrate
          ? sortedIncoming
          : mergeMessageHistory(previousMessages, sortedIncoming);
        ensureMessageOrder(messageOrderRef.current, nextMessageOrderRef, next);
        return next;
      });
      if (hydrate) {
        chatHydrationPendingRef.current = true;
        if (shouldResetStreamKeys) {
          resetStreamKeys();
        }
      }
    },
    [resetStreamKeys],
  );

  const deriveToolTraces = useCallback(
    (items: ChatMessage[]) => deriveToolTracesFromMessages(items),
    [],
  );

  const authToken = token ?? "";
  const openrouterConfigured = Boolean(!authLoading && user?.openrouter_configured);
  const pineconeConfigured = Boolean(!authLoading && user?.pinecone_configured);

  const { runSettingsOrder, setRunSettingsOrder } = useRunSettingsOrder({
    authToken,
    user,
    refreshProfile,
    onError: setStatus,
  });

  const { startProgressPolling, stopProgressPolling } = useSessionHistoryPolling({
    authToken,
    selectedSessionId,
    isStreamingResponseRef,
    syncMessages,
    setToolTraces,
    setUsage,
  });

  const {
    collections,
    collectionsLoading,
    collectionsError,
    selectedToolCollectionIds,
    setSelectedToolCollectionIds,
    historyFilterCollectionIds,
    historyFilterIncludeUnassigned,
    historyFilterActive,
    handleHistoryFilterChange,
    documentCount,
    contextWindow,
    setContextWindow,
    resolveValidToolCollectionIds,
    selectedToolCollections,
    primaryCollection,
    collectionLabel,
    collectionMetaLabel,
    toggleToolCollection,
    clearToolCollections,
    toolCollectionsDirtyRef,
  } = useCollectionTools({
    authToken,
    authLoading,
    pineconeConfigured,
    selectedSessionId,
    urlCollectionsValue,
    setSessions,
  });

  const toolsEnabled = selectedToolCollectionIds.length > 0;

  useEffect(() => {
    if (isPendingSession) {
      return;
    }
    if (sessionIdParam !== selectedSessionId) {
      return;
    }
    replaceUrl(buildChatUrl(selectedSessionId, selectedToolCollectionIds));
  }, [
    buildChatUrl,
    replaceUrl,
    isPendingSession,
    selectedSessionId,
    sessionIdParam,
    selectedToolCollectionIds,
  ]);

  const {
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
  } = useModelCatalog({
    authToken,
    authLoading,
    openrouterConfigured,
    activeModelId,
    toolsEnabled,
  });

  const {
    parameterOverrides,
    setParameterOverrides,
    activeParameterCount,
    handleNumberParameterChange,
    handleBooleanParameterChange,
    handleTextParameterChange,
    handleSelectParameterChange,
    handleClearParameter,
    resetAllParameters,
    formatDefaultParameter,
    buildParameterPayload,
  } = useModelParameters({
    currentModelInfo,
    modelCatalog,
    supportedParameterKeys,
  });

  const {
    providerForm,
    setProviderForm,
    providerDirectory,
    providerDirectoryLoading,
    providerDirectoryError,
    providerSearchTerm,
    setProviderSearchTerm,
    providerPayload,
    providerRuleCount,
  } = useProviderPreferences({
    authToken,
    authLoading,
    openrouterConfigured,
    providerModelSlug,
  });

  const {
    promptEditorRef,
    promptEditorOpen,
    activePromptSectionId,
    basePromptDetails,
    promptSections,
    promptSectionsSummary,
    promptPreviewMarkdown,
    promptLoading,
    promptError,
    promptGeneratedAt,
    handlePromptEditorOpen,
    handlePromptEditorClose,
    handlePromptSectionSelect,
    handlePromptDraftChange,
    handlePromptSave,
    handlePromptReset,
    handleInsertPromptVariable,
  } = usePromptEditor({
    authToken,
    authLoading,
    selectedToolCollectionIds,
    selectedToolCollections,
  });

  const sortSessions = useCallback((items: ChatSession[]) => {
    const pendingIds = pendingSessionIdsRef.current;
    return [...items].sort((a, b) => {
      const aPending = pendingIds.has(a.id);
      const bPending = pendingIds.has(b.id);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!authToken) {
      setLoading(false);
      setStatus("Sign in to access the chat studio.");
      return;
    }
    if (!openrouterConfigured) {
      setLoading(false);
      setStatus("OpenRouter API key is not configured. Update it in Settings to continue.");
      return;
    }
    setStatus(null);
  }, [authLoading, authToken, openrouterConfigured]);

  useEffect(() => {
    if (authLoading || !authToken || !openrouterConfigured) {
      setSessions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setStatus(null);
    const options = historyFilterActive
      ? {
          collectionIds: historyFilterCollectionIds,
          includeUnassigned: historyFilterIncludeUnassigned,
        }
      : undefined;
    listChatSessions(authToken, options)
      .then((sessionList) => {
        if (cancelled) return;
        const sorted = sortSessions(sessionList);
        setSessions(sorted);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Unable to load chat sessions.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("chatStudio.loaded", "true");
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    authToken,
    historyFilterActive,
    historyFilterCollectionIds,
    historyFilterIncludeUnassigned,
    openrouterConfigured,
    sessionIdParam,
    sortSessions,
  ]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (session?.chat_model) {
      setActiveModelId((current) =>
        current === session.chat_model ? current : session.chat_model,
      );
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!activeModelId) {
      previousModelIdRef.current = null;
      return;
    }
    const previous = previousModelIdRef.current;
    if (previous && previous !== activeModelId) {
      setParameterOverrides({});
      setProviderForm(createDefaultProviderForm());
    }
    previousModelIdRef.current = activeModelId;
  }, [activeModelId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    if (pendingSessionIdsRef.current.has(selectedSessionId)) {
      return;
    }
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (!session) {
      return;
    }
    setSelectedToolCollectionIds(session.tool_collection_ids ?? []);
    setParameterOverrides(session.parameter_overrides ?? {});
    setProviderForm(createProviderFormFromPreferences(session.provider_preferences));
    setStreamingEnabled(session.stream ?? DEFAULT_STREAMING_ENABLED);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      applyNewChatDefaultsRef.current = true;
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (loading || selectedSessionId || !applyNewChatDefaultsRef.current) {
      return;
    }
    if (newChatDefaultsRef.current) {
      const snapshot = newChatDefaultsRef.current;
      setActiveModelId(snapshot.activeModelId);
      setParameterOverrides(snapshot.parameterOverrides);
      setProviderForm(snapshot.providerForm);
      setStreamingEnabled(snapshot.streamingEnabled);
      setSelectedToolCollectionIds(snapshot.toolCollectionIds);
      newChatDefaultsRef.current = null;
      applyNewChatDefaultsRef.current = false;
      return;
    }
    const pendingIds = pendingSessionIdsRef.current;
    const latestSession = sessions.find((session) => !pendingIds.has(session.id)) ?? null;
    if (latestSession) {
      setActiveModelId(latestSession.chat_model);
      setParameterOverrides(latestSession.parameter_overrides ?? {});
      setProviderForm(createProviderFormFromPreferences(latestSession.provider_preferences));
      setStreamingEnabled(latestSession.stream ?? DEFAULT_STREAMING_ENABLED);
      setSelectedToolCollectionIds(latestSession.tool_collection_ids ?? []);
    } else if (user) {
      setActiveModelId(user.last_used_chat_model ?? null);
      setParameterOverrides(user.last_used_parameters ?? {});
      setProviderForm(createProviderFormFromPreferences(user.last_used_provider));
      setStreamingEnabled(user.last_used_stream ?? DEFAULT_STREAMING_ENABLED);
      setSelectedToolCollectionIds(
        resolveValidToolCollectionIds(user.last_used_tool_collection_ids ?? []),
      );
    }
    applyNewChatDefaultsRef.current = false;
  }, [loading, resolveValidToolCollectionIds, selectedSessionId, sessions, user]);

  useEffect(() => {
    if (!authToken) return;
    if (!selectedSessionId) {
      setMessages([]);
      setToolTraces([]);
      setChatEntryOrder([]);
      chatHydrationPendingRef.current = true;
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    if (pendingSessionIdsRef.current.has(selectedSessionId)) {
      setMessages([]);
      setToolTraces([]);
      chatHydrationPendingRef.current = true;
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    if (skipHistoryFetchSessionRef.current === selectedSessionId) {
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      try {
        const history = await getChatHistory(authToken, selectedSessionId!);
        if (!cancelled) {
          syncMessages(history, { hydrate: true, resetStreamKeys: true });
          setToolTraces(deriveToolTraces(history));
          setUsage(calculateSessionUsage(history));
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Unable to load chat history.");
        }
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [authToken, selectedSessionId, syncMessages, deriveToolTraces]);

  useEffect(() => {
    if (!selectedSessionId) {
      setOptimisticMessages([]);
      return;
    }
    setOptimisticMessages((prev) =>
      prev.filter((message) => message.session_id === selectedSessionId),
    );
  }, [selectedSessionId]);

  useEffect(() => {
    setOptimisticMessages((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      return prev.filter((optimistic) => {
        const trimmedOptimistic = optimistic.content.trim();
        if (!trimmedOptimistic) {
          return false;
        }
        const duplicate = messages.some((message) => {
          if (message.id === optimistic.id) {
            return false;
          }
          return isOptimisticDuplicate(optimistic, message, messageOrderRef.current);
        });
        return !duplicate;
      });
    });
  }, [messages]);

  useEffect(() => {
    if (!selectedSessionId) {
      setContextConsumed(0);
      return;
    }
    const activeSession = sessions.find((session) => session.id === selectedSessionId);
    if (activeSession) {
      setContextConsumed(activeSession.context_tokens);
    }
  }, [selectedSessionId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const branchedFromSession = useMemo(() => {
    if (!activeSession?.branched_from_session_id) {
      return null;
    }
    return (
      sessions.find((session) => session.id === activeSession.branched_from_session_id) ?? null
    );
  }, [activeSession, sessions]);

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

  useEffect(() => {
    reasoningCacheRef.current.clear();
  }, [selectedSessionId]);

  useEffect(() => {
    const element = chatPanelRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setChatPanelWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isOverlayMode) {
      return;
    }
    if (historyOpen && telemetryOpen) {
      setTelemetryOpen(false);
    }
  }, [historyOpen, isOverlayMode, telemetryOpen, setTelemetryOpen]);

  const getPersistedReasoningSegments = useCallback(
    (messageId: string, segments: ReasoningTraceSegment[]) => {
      if (segments.length > 0) {
        reasoningCacheRef.current.set(messageId, segments);
        return segments;
      }
      return reasoningCacheRef.current.get(messageId) ?? segments;
    },
    [],
  );

  useLayoutEffect(() => {
    if (!editingMessageId) {
      editScrollSnapshotRef.current = null;
      if (editAutoScrollRef.current !== null) {
        setAutoScrollEnabled(editAutoScrollRef.current);
        editAutoScrollRef.current = null;
      }
      return;
    }
    const container = messagesContainerRef.current;
    const snapshot = editScrollSnapshotRef.current;
    if (!container || !snapshot) {
      return;
    }
    const previousBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = "auto";
    container.scrollTop = snapshot.scrollTop;
    container.style.scrollBehavior = previousBehavior;
    editScrollSnapshotRef.current = null;
  }, [editingMessageId]);

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

  const toolTraceMap = useMemo(() => {
    const map = new Map<string, ToolCallTrace>();
    toolTraces.forEach((trace) => map.set(trace.id, trace));
    return map;
  }, [toolTraces]);

  const chatEntries = useMemo<ChatEntry[]>(
    () =>
      buildChatEntries({
        messages,
        optimisticMessages,
        messageOrder: messageOrderRef.current,
        toolTraceMap,
        getPersistedReasoningSegments,
        formatToolLabel,
      }),
    [getPersistedReasoningSegments, messages, optimisticMessages, toolTraceMap],
  );

  const chatEntryMap = useMemo(() => {
    const map = new Map<string, ChatEntry>();
    chatEntries.forEach((entry) => map.set(entry.id, entry));
    return map;
  }, [chatEntries]);

  const normalizedChatEntryIds = useMemo(() => chatEntries.map((entry) => entry.id), [chatEntries]);

  useEffect(() => {
    setChatEntryOrder((prev) => {
      const sameOrder =
        prev.length === normalizedChatEntryIds.length &&
        prev.every((id, index) => id === normalizedChatEntryIds[index]);
      if (sameOrder) {
        return prev;
      }
      return normalizedChatEntryIds;
    });
    chatHydrationPendingRef.current = false;
  }, [normalizedChatEntryIds]);

  const chatInputPlaceholder = toolsEnabled
    ? "Ask about the selected collections…"
    : "Ask anything…";

  // Remove live tool events once their persisted counterparts are present
  useEffect(() => {
    const persistedToolIds = new Set<string>();
    messages.forEach((message) => {
      if (message.role === "tool") {
        const toolId = message.tool_call_id || message.id;
        if (toolId) {
          persistedToolIds.add(toolId);
        }
      }
    });
    if (persistedToolIds.size === 0) return;
    pruneLiveToolEvents(persistedToolIds);
  }, [messages, pruneLiveToolEvents]);

  const applyChatResponse = useCallback(
    (response: ChatCompletionPayload) => {
      const finalAssistant = [...response.messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const streamedReasoningSegments = completeStream(finalAssistant?.id ?? null);
      const wasPending = pendingSessionIdsRef.current.has(response.session.id);
      pendingSessionIdsRef.current.delete(response.session.id);
      if (wasPending) {
        navigateToChat(response.session.id, selectedToolCollectionIds);
      }

      // Check if we need to inject persisted reasoning into the final assistant message
      // This handles the case where the tool call response doesn't include the reasoning trace
      // that was just streamed.
      let messagesToSync = response.messages;
      if (finalAssistant && streamedReasoningSegments.length > 0) {
        const hasReasoning =
          finalAssistant.reasoning_trace?.segments &&
          finalAssistant.reasoning_trace.segments.length > 0;
        if (!hasReasoning) {
          messagesToSync = messagesToSync.map((msg) => {
            if (msg.id === finalAssistant.id) {
              return {
                ...msg,
                reasoning_trace: {
                  segments: streamedReasoningSegments,
                },
              };
            }
            return msg;
          });
        }
      }

      const enrichedMessages = attachUsageToLastAssistantMessage(
        messagesToSync,
        response.usage ?? null,
      );
      // Always hydrate when streaming to prevent delayed message reveals
      syncMessages(enrichedMessages, { hydrate: true });
      const nextToolTraces =
        response.tool_traces && response.tool_traces.length > 0
          ? response.tool_traces
          : deriveToolTraces(response.messages);
      setToolTraces(nextToolTraces);
      setUsage(calculateSessionUsage(enrichedMessages) ?? response.usage ?? null);
      setContextConsumed(response.context_consumed);
      setContextWindow(response.context_window || contextWindow || 0);
      setActiveModelId(response.session.chat_model);
      const resolvedSession =
        toolCollectionsDirtyRef.current && response.session.tool_collection_ids
          ? { ...response.session, tool_collection_ids: selectedToolCollectionIds }
          : response.session;
      if (response.session.tool_collection_ids) {
        setSelectedToolCollectionIds((prev) => {
          if (toolCollectionsDirtyRef.current) {
            return prev;
          }
          return areArraysEqual(prev, response.session.tool_collection_ids)
            ? prev
            : response.session.tool_collection_ids;
        });
      }
      setParameterOverrides(response.session.parameter_overrides ?? {});
      setProviderForm(createProviderFormFromPreferences(response.session.provider_preferences));
      setStreamingEnabled(response.session.stream ?? DEFAULT_STREAMING_ENABLED);
      setSessions((prev) => {
        const next = [...prev];
        const idx = next.findIndex((session) => session.id === response.session.id);
        if (idx >= 0) {
          next[idx] = resolvedSession;
        } else {
          next.push(resolvedSession);
        }
        return sortSessions(next);
      });
    },
    [
      completeStream,
      contextWindow,
      deriveToolTraces,
      navigateToChat,
      selectedToolCollectionIds,
      sortSessions,
      syncMessages,
    ],
  );

  const isAbortError = (value: unknown): value is DOMException =>
    value instanceof DOMException && value.name === "AbortError";

  const handleSend = async () => {
    if (!authToken || !user) return;
    if (toolsEnabled && !pineconeConfigured) {
      setStatus(PINECONE_KEY_REQUIRED_MESSAGE);
      return;
    }
    const targetModelId = activeModelId;
    if (!targetModelId) {
      setStatus("Select a chat model before sending a message.");
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    const parameterPayload = buildParameterPayload();
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = providerRuleCount > 0 ? providerPayload : undefined;
    let sessionId = selectedSessionId;
    const isNewSession = !sessionId;
    if (!sessionId) {
      sessionId = generateClientSessionId();
      const placeholderSession: ChatSession = {
        id: sessionId,
        user_id: user.id,
        title: `Chat ${new Date().toLocaleTimeString()}`,
        mode: "chat",
        chat_model: targetModelId,
        context_tokens: 0,
        tool_collection_ids: selectedToolCollectionIds,
        parameter_overrides: parameters ?? {},
        provider_preferences: provider ?? {},
        stream: streamingEnabled,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSessions((prev) => sortSessions([...prev, placeholderSession]));
      pendingSessionIdsRef.current.add(sessionId);
      setMessages([]);
      setToolTraces([]);
      setChatEntryOrder([]);
      chatHydrationPendingRef.current = true;
      setUsage(null);
      setContextConsumed(0);
      setOptimisticMessages([]);
      navigateToChat(sessionId, selectedToolCollectionIds);
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });
    }
    if (!sessionId) return;

    setDraft("");
    const placeholderMessageId = generateClientMessageId();
    const placeholderMessage: ChatMessage = {
      id: placeholderMessageId,
      session_id: sessionId,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    ensureMessageOrder(messageOrderRef.current, nextMessageOrderRef, [placeholderMessage]);
    setOptimisticMessages((prev) => [...prev, placeholderMessage]);
    setChatEntryOrder((prev) => {
      if (prev.includes(placeholderMessageId)) {
        return prev;
      }
      return isNewSession ? [placeholderMessageId] : [...prev, placeholderMessageId];
    });

    resetLiveMessage();
    try {
      await performChatMutation(sessionId, {
        content: trimmed,
        mode: "chat",
        title: isNewSession ? `Chat ${new Date().toLocaleTimeString()}` : undefined,
        chat_model: targetModelId,
        parameters,
        provider,
        stream: streamingEnabled,
      });
    } catch (error) {
      const aborted = isAbortError(error);
      if (sessionId) {
        pendingSessionIdsRef.current.delete(sessionId);
      }
      if (!aborted) {
        setDraft(trimmed);
      }
      if (isNewSession && sessionId && !aborted) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        navigateToChat(null, selectedToolCollectionIds);
      }
      if (!aborted) {
        const statusMessage =
          error instanceof Error ? error.message : "Unable to send your message.";
        setStatus(statusMessage);
      }
    } finally {
      setOptimisticMessages((prev) =>
        prev.filter((message) => message.id !== placeholderMessageId),
      );
    }
  };

  const handleStopGeneration = useCallback(() => {
    if (!sending) {
      return;
    }
    setIsStopping(true);
    abortControllerRef.current?.abort();
    stopProgressPolling();
  }, [sending, stopProgressPolling]);

  const runEditMutation = async (
    messageId: string,
    newContent: string,
    overrides: {
      sessionId?: string;
      modelId?: string;
      toolCollectionIds?: string[];
      messages?: ChatMessage[];
      parameterOverrides?: ParameterOverrides;
      provider?: ProviderPreferences;
      stream?: boolean;
    } = {},
  ) => {
    const sessionId = overrides.sessionId ?? selectedSessionId;
    if (!authToken || !sessionId) return;
    if (toolsEnabled && !pineconeConfigured) {
      setStatus(PINECONE_KEY_REQUIRED_MESSAGE);
      return;
    }
    const targetModelId = overrides.modelId ?? activeModelId;
    if (!targetModelId) {
      setStatus("Select a chat model before sending a message.");
      return;
    }
    const parameterPayload = buildParameterPayload(overrides.parameterOverrides, overrides.modelId);
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = overrides.provider ?? (providerRuleCount > 0 ? providerPayload : undefined);
    const baseMessages = overrides.messages ?? messages;
    const prunedMessages = pruneHistoryForEdit(baseMessages, messageId, newContent);
    if (prunedMessages !== baseMessages) {
      syncMessages(prunedMessages, { hydrate: true });
      setToolTraces(deriveToolTraces(prunedMessages));
      setUsage(calculateSessionUsage(prunedMessages));
    }
    try {
      await performChatMutation(
        sessionId,
        {
          content: newContent,
          edit_message_id: messageId,
          mode: "chat",
          chat_model: targetModelId,
          parameters,
          provider,
          stream: overrides.stream ?? streamingEnabled,
        },
        overrides.toolCollectionIds,
      );
      setEditingMessageId(null);
      setEditingDraft("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to edit this turn.");
    } finally {
      if (skipHistoryFetchSessionRef.current === sessionId) {
        skipHistoryFetchSessionRef.current = null;
      }
    }
  };

  const handleEditSubmit = async () => {
    if (!editingMessageId) return;
    const trimmed = editingDraft.trim();
    if (!trimmed) {
      setStatus("Edited message cannot be empty.");
      return;
    }
    const branched = await branchSessionForEdit(editingMessageId, "edit");
    if (!branched) {
      return;
    }
    const targetMessage =
      branched.messages.find(
        (message) => message.source_message_id === editingMessageId && message.role === "user",
      ) ??
      branched.messages.find((message) => message.source_message_id === editingMessageId) ??
      branched.messages.find((message) => message.id === editingMessageId) ??
      null;
    if (!targetMessage) {
      setStatus("Unable to locate the branched message to edit.");
      return;
    }
    await runEditMutation(targetMessage.id, trimmed, {
      sessionId: branched.session.id,
      modelId: branched.session.chat_model,
      toolCollectionIds: branched.session.tool_collection_ids ?? [],
      messages: branched.messages,
      parameterOverrides: branched.session.parameter_overrides ?? {},
      provider: branched.session.provider_preferences ?? undefined,
      stream: branched.session.stream ?? DEFAULT_STREAMING_ENABLED,
    });
  };

  const handleRetryAssistant = async (messageId: string) => {
    await runEditMutation(messageId, "");
  };

  const branchSessionForEdit = useCallback(
    async (messageId: string, origin: "edit" | "manual") => {
      if (!authToken || !selectedSessionId) {
        return null;
      }
      try {
        const response = await branchChatSession(authToken, selectedSessionId, {
          message_id: messageId,
        });
        const branchedSession = response.session;
        const branchedMessages = response.messages;
        setSessions((prev) => {
          const next = prev.filter((session) => session.id !== branchedSession.id);
          next.push(branchedSession);
          return sortSessions(next);
        });
        setActiveModelId(branchedSession.chat_model);
        setSelectedToolCollectionIds(branchedSession.tool_collection_ids ?? []);
        setParameterOverrides(branchedSession.parameter_overrides ?? {});
        setProviderForm(createProviderFormFromPreferences(branchedSession.provider_preferences));
        setStreamingEnabled(branchedSession.stream ?? DEFAULT_STREAMING_ENABLED);
        setUsage(calculateSessionUsage(branchedMessages));
        setContextConsumed(branchedSession.context_tokens ?? 0);
        setToolTraces(deriveToolTraces(branchedMessages));
        setChatEntryOrder([]);
        chatHydrationPendingRef.current = true;
        resetChatStream();
        setEditingMessageId(null);
        setEditingDraft("");
        setOptimisticMessages([]);
        toolCollectionsDirtyRef.current = false;
        branchedSessionOriginRef.current.set(branchedSession.id, origin);
        if (origin === "edit") {
          skipHistoryFetchSessionRef.current = branchedSession.id;
        }
        syncMessages(branchedMessages, { hydrate: true, resetStreamKeys: true });
        navigateToChat(branchedSession.id, branchedSession.tool_collection_ids ?? []);
        return { session: branchedSession, messages: branchedMessages };
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to branch this message.");
        return null;
      }
    },
    [
      authToken,
      deriveToolTraces,
      navigateToChat,
      resetChatStream,
      selectedSessionId,
      sortSessions,
      syncMessages,
    ],
  );

  const handleBranchMessage = useCallback(
    async (messageId: string) => {
      await branchSessionForEdit(messageId, "manual");
    },
    [branchSessionForEdit],
  );

  const handleStartNewChat = () => {
    stopProgressPolling();
    newChatDefaultsRef.current = {
      activeModelId,
      parameterOverrides,
      providerForm,
      streamingEnabled,
      toolCollectionIds: selectedToolCollectionIds,
    };
    applyNewChatDefaultsRef.current = true;
    pendingSessionIdsRef.current.clear();
    toolCollectionsDirtyRef.current = false;
    setMessages([]);
    setToolTraces([]);
    setChatEntryOrder([]);
    chatHydrationPendingRef.current = true;
    resetChatStream();
    setUsage(null);
    setContextConsumed(0);
    setDraft("");
    setEditingMessageId(null);
    setEditingDraft("");
    setOptimisticMessages([]);
    navigateToChat(null, selectedToolCollectionIds);
  };

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

  const handleOverrideSelect = useCallback(
    (sectionId: string) => {
      setTelemetryOpen(true);
      switch (sectionId) {
        case TELEMETRY_SECTION_IDS.systemPrompt:
          setSystemPromptOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.collectionTools:
          setCollectionToolsOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.streaming:
          setStreamingOptionsOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.modelRouting:
          setModelSelectorOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.providerRouting:
          setProviderPreferencesOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.modelParameters:
          setModelParametersOpen(true);
          break;
        default:
          break;
      }
      if (typeof document === "undefined") {
        return;
      }
      const scrollToSection = () => {
        const target = document.getElementById(sectionId);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
      window.requestAnimationFrame(scrollToSection);
      window.setTimeout(scrollToSection, 80);
    },
    [
      setCollectionToolsOpen,
      setModelParametersOpen,
      setModelSelectorOpen,
      setProviderPreferencesOpen,
      setStreamingOptionsOpen,
      setSystemPromptOpen,
      setTelemetryOpen,
    ],
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((item) => item.id === sessionId);
      navigateToChat(sessionId, session?.tool_collection_ids ?? []);
    },
    [navigateToChat, sessions],
  );

  const handleDeleteSession = async (sessionId: string) => {
    if (!authToken) return;
    setStatus(null);
    setDeletingSessionId(sessionId);
    try {
      await deleteChatSession(authToken, sessionId);
      let nextSelectedId: string | null = null;
      setSessions((prev) => {
        const next = prev.filter((session) => session.id !== sessionId);
        if (selectedSessionId === sessionId) {
          nextSelectedId = next[0]?.id ?? null;
        }
        return next;
      });
      if (selectedSessionId === sessionId) {
        if (nextSelectedId) {
          const nextSession = sessions.find((session) => session.id === nextSelectedId);
          navigateToChat(nextSelectedId, nextSession?.tool_collection_ids ?? []);
        } else {
          handleStartNewChat();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete chat session.");
    } finally {
      setDeletingSessionId((current) => (current === sessionId ? null : current));
    }
  };


  const performChatMutation = useCallback(
    async (
      sessionId: string,
      payload: Omit<ChatRequestPayload, "session_id">,
      toolCollectionIdsOverride?: string[] | null,
    ) => {
      if (!authToken) {
        throw new Error("Missing authentication context.");
      }
      if (toolsEnabled && !pineconeConfigured) {
        setStatus(PINECONE_KEY_REQUIRED_MESSAGE);
        throw new Error("Pinecone API key is not configured.");
      }
      const controller = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = controller;
      setIsStopping(false);
      setSending(true);
      setStatus(null);
      toolCollectionsDirtyRef.current = false;
      beginMutation();
      if (!payload.stream) {
        startProgressPolling(sessionId);
      }
      try {
        const requestPayload: ChatRequestPayload = {
          ...payload,
          session_id: sessionId,
          tool_collection_ids: toolCollectionIdsOverride ?? selectedToolCollectionIds,
        };
        let result: ChatCompletionPayload | null;
        if (payload.stream) {
          const streamKey = `stream-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          beginStream(streamKey);
          result = await streamChat(authToken, requestPayload, {
            signal: controller.signal,
            onToken: handleToken,
            onReasoning: handleReasoning,
            onToolCall: handleToolCall,
            onToolResult: handleToolResult,
            onError: (message) => {
              setStatus(message);
            },
          });
        } else {
          result = await chat(authToken, requestPayload, controller.signal);
        }
        if (!result) {
          throw new Error("Streaming response did not complete.");
        }
        applyChatResponse(result);
        return result;
      } catch (error) {
        failStream(!isAbortError(error));
        throw error;
      } finally {
        stopProgressPolling();
        setSending(false);
        setIsStopping(false);
        abortControllerRef.current = null;
      }
    },
    [
      applyChatResponse,
      authToken,
      beginMutation,
      beginStream,
      failStream,
      handleReasoning,
      handleToken,
      handleToolCall,
      handleToolResult,
      pineconeConfigured,
      selectedToolCollectionIds,
      startProgressPolling,
      stopProgressPolling,
      toolsEnabled,
    ],
  );

  const handleHistoryClose = useCallback(() => {
    setHistoryOpen(false);
  }, [setHistoryOpen]);

  const handleTelemetryClose = useCallback(() => {
    setTelemetryOpen(false);
  }, [setTelemetryOpen]);

  const handleHistoryOpen = useCallback(() => {
    setHistoryOpen(true);
    if (isOverlayMode) {
      setTelemetryOpen(false);
    }
  }, [isOverlayMode, setHistoryOpen, setTelemetryOpen]);

  const handleTelemetryOpen = useCallback(() => {
    setTelemetryOpen(true);
    if (isOverlayMode) {
      setHistoryOpen(false);
    }
  }, [isOverlayMode, setHistoryOpen, setTelemetryOpen]);

  const currentModelLabel = currentModelInfo?.name || activeModelId || "Select model";

  const historyPanel = (
    <HistoryPanel
      collections={collections}
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      onSelect={handleSelectSession}
      onNewChat={handleStartNewChat}
      filterCollectionIds={historyFilterCollectionIds}
      filterIncludeUnassigned={historyFilterIncludeUnassigned}
      onFilterChange={handleHistoryFilterChange}
      onDelete={handleDeleteSession}
      deletingSessionId={deletingSessionId}
      onClose={handleHistoryClose}
    />
  );

  const telemetryPanel = (
    <TelemetryPanel
      onClose={handleTelemetryClose}
      sectionIds={TELEMETRY_SECTION_IDS}
      sectionOrder={runSettingsOrder}
      onSectionOrderChange={setRunSettingsOrder}
      systemPromptCustom={Boolean(basePromptDetails?.is_custom)}
      promptSections={promptSectionsSummary}
      promptPreviewMarkdown={promptPreviewMarkdown}
      promptLoading={promptLoading}
      promptError={promptError}
      promptGeneratedAt={promptGeneratedAt}
      systemPromptOpen={systemPromptOpen}
      onSystemPromptToggle={() => setSystemPromptOpen((prev) => !prev)}
      onPromptEdit={handlePromptEditorOpen}
      collections={collections}
      selectedToolCollectionIds={selectedToolCollectionIds}
      onToggleToolCollection={toggleToolCollection}
      onClearToolCollections={clearToolCollections}
      collectionsLoading={collectionsLoading}
      collectionsError={collectionsError}
      pineconeConfigured={pineconeConfigured}
      collectionToolsOpen={collectionToolsOpen}
      onCollectionToolsToggle={() => setCollectionToolsOpen((prev) => !prev)}
      streamingOptionsOpen={streamingOptionsOpen}
      onStreamingOptionsToggle={() => setStreamingOptionsOpen((prev) => !prev)}
      streamingEnabled={streamingEnabled}
      onStreamingToggle={setStreamingEnabled}
      modelSelectorOpen={modelSelectorOpen}
      onModelSelectorToggle={() => setModelSelectorOpen((prev) => !prev)}
      modelSearchTerm={modelSearchTerm}
      onModelSearchChange={setModelSearchTerm}
      modelSortOption={modelSortOption}
      onModelSortChange={setModelSortOption}
      toolReadyModels={toolReadyModels}
      filteredModelCatalog={sortedModelCatalog}
      modelsLoading={modelsLoading}
      modelsError={modelsError}
      selectedModelKey={selectedModelKey}
      onSelectModel={setActiveModelId}
      currentModelInfo={currentModelInfo}
      toolsEnabled={toolsEnabled}
      providerPreferencesOpen={providerPreferencesOpen}
      onProviderPreferencesToggle={() => setProviderPreferencesOpen((prev) => !prev)}
      providerForm={providerForm}
      setProviderForm={setProviderForm}
      providerDirectory={providerDirectory}
      providerDirectoryLoading={providerDirectoryLoading}
      providerDirectoryError={providerDirectoryError}
      providerModelSlug={providerModelSlug}
      providerSearchTerm={providerSearchTerm}
      onProviderSearchChange={setProviderSearchTerm}
      providerRuleCount={providerRuleCount}
      resetProviderPreferences={() => setProviderForm(createDefaultProviderForm())}
      vitalsOpen={vitalsOpen}
      onVitalsToggle={() => setVitalsOpen((prev) => !prev)}
      collection={primaryCollection}
      collectionCount={selectedToolCollectionIds.length}
      documentCount={documentCount}
      modelParametersOpen={modelParametersOpen}
      onModelParametersToggle={() => setModelParametersOpen((prev) => !prev)}
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
      usageOpen={usageOpen}
      onUsageToggle={() => setUsageOpen((prev) => !prev)}
      usage={usage}
      contextWindow={contextWindow}
      contextConsumed={contextConsumed}
      onExportChatHistory={handleExportChatHistory}
      markdownComponents={markdownComponents}
    />
  );

  const header = (
    <ChatStudioHeader
      collectionLabel={collectionLabel}
      collectionMetaLabel={collectionMetaLabel}
      currentModelLabel={currentModelLabel}
      showNewChatButton={!historyOpen}
      onModelSelect={() => handleOverrideSelect(TELEMETRY_SECTION_IDS.modelRouting)}
      onNewChat={handleStartNewChat}
    />
  );

  const messagesPanel = (
    <ChatStudioMessages
      messagesContainerRef={messagesContainerRef}
      endRef={endRef}
      onScroll={handleScroll}
      showFollowButton={showFollowButton}
      onFollow={handleReenableAutoScroll}
      timelineProps={{
        modelLabel: currentModelLabel,
        onModelSelect: () => handleOverrideSelect(TELEMETRY_SECTION_IDS.modelRouting),
        chatEntryOrder,
        chatEntryMap,
        finalStreamAssistantId,
        streamEntryKeyMap,
        liveToolEvents,
        selectedSessionId,
        sending,
        editingMessageId,
        editingDraft,
        onEditChange: setEditingDraft,
        onEditStart: (messageId, content) => {
          const container = messagesContainerRef.current;
          if (container) {
            editScrollSnapshotRef.current = {
              scrollTop: container.scrollTop,
              scrollHeight: container.scrollHeight,
            };
          }
          editAutoScrollRef.current = autoScrollEnabled;
          if (autoScrollEnabled) {
            setAutoScrollEnabled(false);
          }
          if (scrollAnimationFrameRef.current) {
            window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
          }
          setEditingMessageId(messageId);
          setEditingDraft(content);
        },
        onEditCancel: () => {
          setEditingMessageId(null);
          setEditingDraft("");
        },
        onEditSubmit: handleEditSubmit,
        onRetryAssistant: handleRetryAssistant,
        onBranchMessage: handleBranchMessage,
        markdownComponents,
        overrideSections,
        onOverrideSelect: handleOverrideSelect,
        liveResponse,
        hasLiveText,
        liveResponseAnimationKey,
        activeStreamEntryKey,
        shouldShowStreamingReasoningBubble,
        liveReasoningAnimationKey,
        liveReasoningBlocks,
        liveReasoningPhase,
        liveToolOrder,
        liveToolPhaseById,
        liveReasoningDisplaySegments,
        showStreamingBubble,
        branchedFromSessionId: activeSession?.branched_from_session_id ?? null,
        branchedFromSessionTitle: branchedFromSession?.title ?? null,
        branchedFromMessageId: activeSession?.branched_from_message_id ?? null,
        branchedFromOrigin: selectedSessionId
          ? (branchedSessionOriginRef.current.get(selectedSessionId) ?? "manual")
          : "manual",
        onNavigateToSession: (sessionId) => {
          const session = sessions.find((item) => item.id === sessionId);
          navigateToChat(sessionId, session?.tool_collection_ids ?? []);
        },
      }}
      inputProps={{
        draft,
        setDraft,
        sending,
        isStopping,
        onSend: handleSend,
        onStop: handleStopGeneration,
        inputRef: chatPromptRef,
        placeholder: chatInputPlaceholder,
      }}
    />
  );

  const promptEditor = (
    <PromptEditorOverlay
      isOpen={promptEditorOpen}
      onClose={handlePromptEditorClose}
      sections={promptSections}
      activeSectionId={activePromptSectionId}
      onSelectSection={handlePromptSectionSelect}
      onDraftChange={handlePromptDraftChange}
      promptPreviewMarkdown={promptPreviewMarkdown}
      onSave={handlePromptSave}
      onReset={handlePromptReset}
      onInsertVariable={handleInsertPromptVariable}
      inputRef={promptEditorRef}
      markdownComponents={markdownComponents}
    />
  );

  return (
    <ChatStudioView
      status={status}
      onStatusDismiss={() => setStatus(null)}
      loading={loading}
      chatPanelRef={chatPanelRef}
      isOverlayMode={isOverlayMode}
      historyOpen={historyOpen}
      telemetryOpen={telemetryOpen}
      onOpenHistory={handleHistoryOpen}
      onCloseHistory={handleHistoryClose}
      onOpenTelemetry={handleTelemetryOpen}
      onCloseTelemetry={handleTelemetryClose}
      header={header}
      messagesPanel={messagesPanel}
      historyPanel={historyPanel}
      telemetryPanel={telemetryPanel}
      promptEditor={promptEditor}
    />
  );
}
