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
  buildChatEntries,
  calculateSessionUsage,
  createDefaultProviderForm,
  createProviderFormFromPreferences,
  deriveToolTracesFromMessages,
  ensureMessageOrder,
  isOptimisticDuplicate,
  mergeMessageHistory,
  sortMessagesChronologically,
} from "@/components/chat-studio/chat-helpers";
import { ChatStudioHeader } from "@/components/chat-studio/ChatStudioHeader";
import { ChatStudioMessages } from "@/components/chat-studio/ChatStudioMessages";
import { ChatStudioView } from "@/components/chat-studio/ChatStudioView";
import { useAutoScroll } from "@/components/chat-studio/hooks/use-auto-scroll";
import { useChatMutation } from "@/components/chat-studio/hooks/use-chat-mutation";
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
import { getChatHistory, listChatSessions } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import { markdownComponents, sanitizeFileName } from "./chat-utils";

import type { ChatEntry } from "./chat-types";
import type { ProviderFormState } from "@/components/chat-studio/types";
import type { ParameterOverrides } from "@/lib/chat-parameters";
import type {
  ChatMessage,
  ChatSession,
  Collection,
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
  // First paint uses the default so server and client markup agree; the stored
  // value is read after mount to avoid a hydration mismatch.
  const [value, setValue] = useState(defaultValue);
  const skipFirstPersistRef = useRef(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) {
      setValue(stored === "true");
    }
  }, [key]);

  useEffect(() => {
    // Skip the initial commit so the default never clobbers the stored value before
    // the hydration effect above has had a chance to apply it.
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
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
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  // Defaults to the loading state; a previously-loaded session is detected after mount.
  const [loading, setLoading] = useState(true);
  // Flips true once storage/viewport values have been read post-mount, so effects that
  // depend on them (e.g. the overlay auto-close) don't act on first-paint defaults.
  const [hydrated, setHydrated] = useState(false);
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
  const chatStream = useChatStream();
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
    resetStreamKeys,
    pruneLiveToolEvents,
  } = chatStream;
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  // Starts at 0 (non-overlay) for a stable first paint; the real width is measured
  // after mount by the ResizeObserver effect below.
  const [chatPanelWidth, setChatPanelWidth] = useState(0);
  const isOverlayMode = chatPanelWidth > 0 && chatPanelWidth < OVERLAY_TRIGGER_WIDTH_PX;
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());
  const newChatDefaultsRef = useRef<{
    activeModelId: string | null;
    parameterOverrides: ParameterOverrides;
    providerForm: ProviderFormState;
    streamingEnabled: boolean;
    toolCollectionIds: string[];
  } | null>(null);
  const reasoningCacheRef = useRef<Map<string, ReasoningTraceSegment[]>>(new Map());
  const messageOrderRef = useRef<Map<string, number>>(new Map());
  const nextMessageOrderRef = useRef(1);

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

  // Derived directly from chatEntries — the render order is whatever the pure
  // buildChatEntries produced, with no state written back from an effect.
  const chatEntryOrder = useMemo(() => chatEntries.map((entry) => entry.id), [chatEntries]);

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

  // Computed fresh every render rather than memoised on selectedSessionId alone,
  // so it reflects the current pending set even when handleSend / applyChatResponse
  // mutate it without changing the selected session.
  const isPendingSession = selectedSessionId
    ? pendingSessionIdsRef.current.has(selectedSessionId)
    : false;

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
      if (hydrate && shouldResetStreamKeys) {
        resetStreamKeys();
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
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    if (pendingSessionIdsRef.current.has(selectedSessionId)) {
      setMessages([]);
      setToolTraces([]);
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

  // Post-mount hydration of storage/viewport-derived state, kept out of the useState
  // initializers so server and first client render agree.
  useEffect(() => {
    if (window.sessionStorage.getItem("chatStudio.loaded") === "true") {
      setLoading(false);
    }
    setChatPanelWidth((prev) => (prev === 0 ? window.innerWidth : prev));
    setHydrated(true);
  }, []);

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
    // Gate on hydration so the auto-close doesn't fire on first-paint defaults before
    // the persisted panel-open values have been read back.
    if (!hydrated || !isOverlayMode) {
      return;
    }
    if (historyOpen && telemetryOpen) {
      setTelemetryOpen(false);
    }
  }, [hydrated, historyOpen, isOverlayMode, telemetryOpen, setTelemetryOpen]);

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


  const {
    handleSend,
    handleStopGeneration,
    handleEditSubmit,
    handleRetryAssistant,
    handleBranchMessage,
    handleStartNewChat,
    handleDeleteSession,
  } = useChatMutation({
    authToken,
    user,
    toolsEnabled,
    pineconeConfigured,
    activeModelId,
    buildParameterPayload,
    providerRuleCount,
    providerPayload,
    parameterOverrides,
    providerForm,
    streamingEnabled,
    selectedSessionId,
    navigateToChat,
    selectedToolCollectionIds,
    setSelectedToolCollectionIds,
    contextWindow,
    setContextWindow,
    toolCollectionsDirtyRef,
    chatStream,
    startProgressPolling,
    stopProgressPolling,
    draft,
    setDraft,
    sessions,
    messages,
    sending,
    editingMessageId,
    editingDraft,
    setSessions,
    setMessages,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setOptimisticMessages,
    setActiveModelId,
    setParameterOverrides,
    setProviderForm,
    setStreamingEnabled,
    setStatus,
    setSending,
    setIsStopping,
    setEditingMessageId,
    setEditingDraft,
    setDeletingSessionId,
    pendingSessionIdsRef,
    skipHistoryFetchSessionRef,
    branchedSessionOriginRef,
    newChatDefaultsRef,
    applyNewChatDefaultsRef,
    abortControllerRef,
    messageOrderRef,
    nextMessageOrderRef,
    syncMessages,
    deriveToolTraces,
    sortSessions,
  });


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
