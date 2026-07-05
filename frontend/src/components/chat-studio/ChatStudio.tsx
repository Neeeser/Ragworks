"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
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
  buildCollectionsQuery,
  calculateSessionUsage,
  createDefaultProviderForm,
  createProviderFormFromPreferences,
  deriveToolTracesFromMessages,
  ensureMessageOrder,
  generateClientMessageId,
  generateClientSessionId,
  isOptimisticDuplicate,
  isToolReasoningSegment,
  makeToolId,
  mergeMessageHistory,
  parseCollectionIdsParam,
  pruneHistoryForEdit,
  sortMessagesChronologically,
} from "@/components/chat-studio/chat-helpers";
import { ChatStudioHeader } from "@/components/chat-studio/ChatStudioHeader";
import { ChatStudioMessages } from "@/components/chat-studio/ChatStudioMessages";
import { ChatStudioView } from "@/components/chat-studio/ChatStudioView";
import { useRunSettingsOrder } from "@/components/chat-studio/hooks/use-run-settings-order";
import { HistoryPanel } from "@/components/chat-studio/HistoryPanel";
import { PromptEditorOverlay } from "@/components/chat-studio/PromptEditorOverlay";
import { TelemetryPanel } from "@/components/chat-studio/telemetry/TelemetryPanel";
import { formatToolLabel } from "@/components/chat-studio/Tooling";
import {
  branchChatSession,
  chat,
  deleteChatSession,
  fetchCollections,
  fetchDocuments,
  fetchPipeline,
  getBasePrompt,
  getChatHistory,
  getCollectionPrompt,
  listChatSessions,
  listModelEndpoints,
  listModels,
  streamChat,
  updateBasePrompt,
  updateCollectionPrompt,
} from "@/lib/api";
import { PARAMETER_DEFINITIONS } from "@/lib/chat-parameters";
import { sortChatModels } from "@/lib/model-sorting";
import { useAuth } from "@/providers/auth-provider";

import {
  coerceRecord,
  safeParseJSON,
  markdownComponents,
  normalizeReasoningSegments,
  parsePriceInput,
  sanitizeFileName,
  sanitizeModelSlug,
} from "./chat-utils";

import type { ChatEntry } from "./chat-types";
import type { ProviderFormState } from "@/components/chat-studio/types";
import type {
  ModelParameterKey,
  ParameterDefinition,
  ParameterOverrides,
  ParameterValue,
} from "@/lib/chat-parameters";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
  ModelEndpointDirectory,
  ModelInfo,
  Pipeline,
  PromptDetails,
  ProviderPreferences,
  ProviderSortOption,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from "@/lib/types";

const HISTORY_PANEL_WIDTH_PX = 288;
const TELEMETRY_PANEL_WIDTH_PX = 416;
const MIN_CENTER_PANEL_WIDTH_PX = 720;
const OVERLAY_TRIGGER_WIDTH_PX =
  HISTORY_PANEL_WIDTH_PX + TELEMETRY_PANEL_WIDTH_PX + MIN_CENTER_PANEL_WIDTH_PX;

const PARAMETER_DEFINITION_MAP: Record<ModelParameterKey, ParameterDefinition> =
  PARAMETER_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.key] = definition;
      return acc;
    },
    {} as Record<ModelParameterKey, ParameterDefinition>,
  );

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

const PROGRESS_POLL_INTERVAL = 800;

export function ChatStudio() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ sessionId?: string | string[] }>();
  const rawSessionId = params.sessionId;
  const sessionIdParam = Array.isArray(rawSessionId)
    ? (rawSessionId[0] ?? null)
    : (rawSessionId ?? null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionIdParam);
  const pendingUrlSessionRef = useRef<{ value: string | null; active: boolean }>({
    value: null,
    active: false,
  });
  const urlCollectionsValue = searchParams.get("collections");
  const urlCollectionIds = useMemo(
    () => parseCollectionIdsParam(urlCollectionsValue),
    [urlCollectionsValue],
  );
  const { token, user, loading: authLoading, refreshProfile } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [selectedToolCollectionIds, setSelectedToolCollectionIds] =
    useState<string[]>(urlCollectionIds);
  const [historyFilterCollectionIds, setHistoryFilterCollectionIds] = useState<string[]>([]);
  const [historyFilterIncludeUnassigned, setHistoryFilterIncludeUnassigned] = useState(false);
  const [documentCount, setDocumentCount] = useState(0);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const selectedSessionId = activeSessionId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolCallTrace[]>([]);
  const [chatEntryOrder, setChatEntryOrder] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(0);
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
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [modelSearchTerm, setModelSearchTerm] = useState("");
  const [modelSortOption, setModelSortOption] = useState<ChatModelSortOption>("price");
  const [parameterOverrides, setParameterOverrides] = useState<ParameterOverrides>({});
  const [providerForm, setProviderForm] = useState<ProviderFormState>(() =>
    createDefaultProviderForm(),
  );
  const previousModelIdRef = useRef<string | null>(null);
  const [providerDirectory, setProviderDirectory] = useState<ModelEndpointDirectory | null>(null);
  const [providerDirectoryLoading, setProviderDirectoryLoading] = useState(false);
  const [providerDirectoryError, setProviderDirectoryError] = useState<string | null>(null);
  const [providerSearchTerm, setProviderSearchTerm] = useState("");
  const applyNewChatDefaultsRef = useRef(true);
  const [basePromptDetails, setBasePromptDetails] = useState<PromptDetails | null>(null);
  const [basePromptLoading, setBasePromptLoading] = useState(false);
  const [basePromptError, setBasePromptError] = useState<string | null>(null);
  const [basePromptDraft, setBasePromptDraft] = useState("");
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [activePromptSectionId, setActivePromptSectionId] = useState("base");
  const [collectionPromptDetails, setCollectionPromptDetails] = useState<
    Record<string, PromptDetails>
  >({});
  const [collectionPromptDrafts, setCollectionPromptDrafts] = useState<Record<string, string>>({});
  const [collectionPromptLoading, setCollectionPromptLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [collectionPromptErrors, setCollectionPromptErrors] = useState<
    Record<string, string | null>
  >({});
  const [promptSavingBySection, setPromptSavingBySection] = useState<Record<string, boolean>>({});
  const [liveResponse, setLiveResponse] = useState("");
  const [isStreamingResponse, setIsStreamingResponse] = useState(false);
  const [liveReasoningSegments, setLiveReasoningSegments] = useState<ReasoningTraceSegment[]>([]);
  const [liveReasoningBlocks, setLiveReasoningBlocks] = useState<ReasoningTraceSegment[][]>([]);
  const [liveReasoningPhase, setLiveReasoningPhase] = useState(0);
  const [persistedLiveReasoningSegments, setPersistedLiveReasoningSegments] = useState<
    ReasoningTraceSegment[]
  >([]);
  const [activeStreamEntryKey, setActiveStreamEntryKey] = useState<string | null>(null);
  const activeStreamEntryKeyRef = useRef<string | null>(null);
  const isStreamingResponseRef = useRef(false);
  const [finalStreamAssistantId, setFinalStreamAssistantId] = useState<string | null>(null);
  const [streamEntryKeyMap, setStreamEntryKeyMap] = useState<Record<string, string>>({});
  const [liveToolEvents, setLiveToolEvents] = useState<ToolCallTrace[]>([]);
  const [liveToolOrder, setLiveToolOrder] = useState<string[]>([]);
  const [liveToolPhaseById, setLiveToolPhaseById] = useState<Record<string, number>>({});
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [liveResponseAnimationKey, setLiveResponseAnimationKey] = useState(0);
  const [liveReasoningAnimationKey, setLiveReasoningAnimationKey] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    if (typeof window === "undefined") {
      return 0;
    }
    return window.innerWidth;
  });
  const isOverlayMode = chatPanelWidth > 0 && chatPanelWidth < OVERLAY_TRIGGER_WIDTH_PX;
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const activePollingSession = useRef<string | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());
  const toolCollectionsDirtyRef = useRef(false);
  const newChatDefaultsRef = useRef<{
    activeModelId: string | null;
    parameterOverrides: ParameterOverrides;
    providerForm: ProviderFormState;
    streamingEnabled: boolean;
    toolCollectionIds: string[];
  } | null>(null);
  const chatHydrationPendingRef = useRef(false);
  const historyFilterTouchedRef = useRef(false);
  const reasoningCacheRef = useRef<Map<string, ReasoningTraceSegment[]>>(new Map());
  const messageOrderRef = useRef<Map<string, number>>(new Map());
  const nextMessageOrderRef = useRef(1);
  const historyFilterActive =
    historyFilterCollectionIds.length > 0 || historyFilterIncludeUnassigned;
  const collectionMap = useMemo(() => {
    return new Map(collections.map((collection) => [collection.id, collection]));
  }, [collections]);
  const resolveValidToolCollectionIds = useCallback(
    (collectionIds: string[]) => {
      if (collectionIds.length === 0) {
        return [];
      }
      if (collectionMap.size === 0) {
        return collectionIds;
      }
      return collectionIds.filter((collectionId) => collectionMap.has(collectionId));
    },
    [collectionMap],
  );
  const selectedToolCollections = useMemo(() => {
    return selectedToolCollectionIds
      .map((collectionId) => collectionMap.get(collectionId))
      .filter(Boolean) as Collection[];
  }, [collectionMap, selectedToolCollectionIds]);
  const primaryCollection = selectedToolCollections[0] ?? null;
  const collectionLabel = useMemo(() => {
    if (selectedToolCollections.length === 0) {
      return "No collections selected";
    }
    if (selectedToolCollections.length === 1) {
      return selectedToolCollections[0].name;
    }
    return `${selectedToolCollections.length} collections selected`;
  }, [selectedToolCollections]);
  const collectionMetaLabel = useMemo(() => {
    if (selectedToolCollections.length === 0) {
      return "No collection tools enabled";
    }
    if (selectedToolCollections.length === 1) {
      return `${documentCount} documents`;
    }
    return `${selectedToolCollections.length} tools enabled`;
  }, [documentCount, selectedToolCollections]);

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
  const hadLiveTextRef = useRef(false);
  const hadLiveReasoningRef = useRef(false);

  const buildChatUrl = useCallback((sessionId: string | null, collectionIds: string[]) => {
    const basePath = sessionId ? `/chat/${sessionId}` : "/chat";
    const query = buildCollectionsQuery(collectionIds);
    return query ? `${basePath}?${query}` : basePath;
  }, []);

  const currentUrl = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const navigateToChat = useCallback(
    (sessionId: string | null, collectionIds: string[]) => {
      const target = buildChatUrl(sessionId, collectionIds);
      if (target !== currentUrl) {
        pendingUrlSessionRef.current = { value: sessionId, active: true };
        setActiveSessionId(sessionId);
        router.push(target);
        return;
      }
      if (sessionId !== activeSessionId) {
        setActiveSessionId(sessionId);
      }
    },
    [activeSessionId, buildChatUrl, currentUrl, router],
  );

  useEffect(() => {
    const pending = pendingUrlSessionRef.current;
    if (pending.active) {
      if (sessionIdParam === pending.value) {
        pendingUrlSessionRef.current = { value: null, active: false };
      } else {
        return;
      }
    }
    if (sessionIdParam !== activeSessionId) {
      setActiveSessionId(sessionIdParam);
    }
  }, [activeSessionId, sessionIdParam]);

  useEffect(() => {
    toolCollectionsDirtyRef.current = false;
  }, [selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId) {
      return;
    }
    if (urlCollectionsValue === null) {
      return;
    }
    const parsed = parseCollectionIdsParam(urlCollectionsValue);
    const resolved = resolveValidToolCollectionIds(parsed);
    setSelectedToolCollectionIds((prev) => (areArraysEqual(prev, resolved) ? prev : resolved));
  }, [resolveValidToolCollectionIds, selectedSessionId, urlCollectionsValue]);

  const isPendingSession = useMemo(() => {
    if (!selectedSessionId) {
      return false;
    }
    return pendingSessionIdsRef.current.has(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    if (isPendingSession) {
      return;
    }
    if (sessionIdParam !== selectedSessionId) {
      return;
    }
    const target = buildChatUrl(selectedSessionId, selectedToolCollectionIds);
    if (target !== currentUrl) {
      router.replace(target);
    }
  }, [
    buildChatUrl,
    currentUrl,
    isPendingSession,
    router,
    selectedSessionId,
    sessionIdParam,
    selectedToolCollectionIds,
  ]);

  useEffect(() => {
    isStreamingResponseRef.current = isStreamingResponse;
  }, [isStreamingResponse]);

  useEffect(() => {
    const hadLiveText = hadLiveTextRef.current;
    hadLiveTextRef.current = hasLiveText;
    if (!hasLiveText || hadLiveText) {
      return;
    }
    setLiveResponseAnimationKey((prev) => prev + 1);
  }, [hasLiveText]);

  useEffect(() => {
    const hasSegments = liveReasoningSegments.length > 0;
    const hadLiveReasoning = hadLiveReasoningRef.current;
    hadLiveReasoningRef.current = hasSegments;
    if (!hasSegments || hadLiveReasoning) {
      return;
    }
    setLiveReasoningAnimationKey((prev) => prev + 1);
  }, [liveReasoningSegments.length]);

  const resetLiveReasoningState = useCallback(() => {
    setLiveReasoningSegments([]);
    setLiveReasoningBlocks([]);
    setLiveReasoningPhase(0);
    setPersistedLiveReasoningSegments([]);
  }, []);

  const upsertLiveToolEvent = useCallback(
    (update: {
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      response?: Record<string, unknown>;
      reasoning?: unknown;
      collection_id?: string;
      collection_name?: string;
    }) => {
      const eventId = update.id || makeToolId();
      const reasoningSegments =
        update.reasoning !== undefined ? normalizeReasoningSegments(update.reasoning) : undefined;
      setLiveToolEvents((prev) => {
        const next = [...prev];
        const existingIndex = next.findIndex((item) => item.id === eventId);
        const base =
          existingIndex >= 0
            ? next[existingIndex]
            : {
                id: eventId,
                name: update.name || "tool_call",
                arguments: {},
                response: {},
                reasoning: null as ToolCallTrace["reasoning"],
                collection_id: update.collection_id ?? null,
                collection_name: update.collection_name ?? null,
              };
        const merged = {
          ...base,
          name: update.name || base.name,
          arguments: { ...base.arguments, ...(update.arguments || {}) },
          response: update.response !== undefined ? update.response || {} : base.response || {},
          collection_id: update.collection_id ?? base.collection_id ?? null,
          collection_name: update.collection_name ?? base.collection_name ?? null,
          reasoning:
            reasoningSegments && reasoningSegments.length > 0
              ? { segments: reasoningSegments }
              : (base.reasoning ?? null),
        };
        if (existingIndex >= 0) {
          next[existingIndex] = merged;
          return next;
        }
        return [...next, merged];
      });
    },
    [],
  );

  const syncMessages = useCallback(
    (
      incoming: ChatMessage[],
      {
        hydrate = false,
        resetStreamKeys = false,
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
        if (resetStreamKeys) {
          setStreamEntryKeyMap({});
          setActiveStreamEntryKey(null);
        }
      }
    },
    [],
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

  const resolveChatSettings = useCallback((pipeline: Pipeline | null) => {
    if (!pipeline) {
      return { contextWindow: 0 };
    }
    const settingsNode = pipeline.definition.nodes.find((node) => node.type === "chat.settings");
    const contextWindow = settingsNode?.config?.context_window;
    return {
      contextWindow: typeof contextWindow === "number" ? contextWindow : 0,
    };
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
    if (authLoading) {
      return;
    }
    if (!authToken || !pineconeConfigured) {
      setCollections([]);
      setCollectionsLoading(false);
      setCollectionsError(pineconeConfigured ? null : PINECONE_KEY_REQUIRED_MESSAGE);
      return;
    }
    let cancelled = false;
    setCollectionsLoading(true);
    setCollectionsError(null);
    fetchCollections(authToken)
      .then((items) => {
        if (!cancelled) {
          setCollections(items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to load collections.";
          setCollectionsError(message);
          setCollections([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCollectionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken, pineconeConfigured]);

  useEffect(() => {
    if (collections.length === 0) {
      return;
    }
    const validIds = new Set(collections.map((collection) => collection.id));
    setSelectedToolCollectionIds((prev) => prev.filter((id) => validIds.has(id)));
    setHistoryFilterCollectionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [collections]);

  useEffect(() => {
    if (!authToken || !primaryCollection) {
      setDocumentCount(0);
      return;
    }
    let cancelled = false;
    fetchDocuments(authToken, primaryCollection.id)
      .then((docs) => {
        if (!cancelled) {
          setDocumentCount(docs.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocumentCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, primaryCollection]);

  useEffect(() => {
    if (!authToken || !primaryCollection) {
      setContextWindow(0);
      return;
    }
    if (!primaryCollection.retrieval_pipeline_id) {
      setContextWindow(0);
      return;
    }
    let cancelled = false;
    fetchPipeline(authToken, primaryCollection.retrieval_pipeline_id)
      .then((pipeline) => {
        if (!cancelled) {
          const settings = resolveChatSettings(pipeline);
          setContextWindow(settings.contextWindow);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContextWindow(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, primaryCollection, resolveChatSettings]);

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
    if (authLoading || !authToken) {
      setBasePromptDetails(null);
      setBasePromptDraft("");
      return;
    }
    let cancelled = false;
    setBasePromptLoading(true);
    setBasePromptError(null);
    getBasePrompt(authToken)
      .then((details) => {
        if (cancelled) return;
        setBasePromptDetails(details);
        setBasePromptDraft((prev) => (prev ? prev : (details.template ?? "")));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Unable to load the base prompt.";
          setBasePromptError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBasePromptLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken]);

  useEffect(() => {
    if (authLoading || !authToken || selectedToolCollectionIds.length === 0) {
      return;
    }
    selectedToolCollectionIds.forEach((collectionId) => {
      if (collectionPromptDetails[collectionId]) {
        return;
      }
      setCollectionPromptLoading((prev) => ({ ...prev, [collectionId]: true }));
      setCollectionPromptErrors((prev) => ({ ...prev, [collectionId]: null }));
      getCollectionPrompt(authToken, collectionId)
        .then((details) => {
          setCollectionPromptDetails((prev) => ({ ...prev, [collectionId]: details }));
          setCollectionPromptDrafts((prev) => {
            if (prev[collectionId] !== undefined) {
              return prev;
            }
            return { ...prev, [collectionId]: details.template ?? "" };
          });
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "Unable to load the tool prompt.";
          setCollectionPromptErrors((prev) => ({ ...prev, [collectionId]: message }));
        })
        .finally(() => {
          setCollectionPromptLoading((prev) => ({ ...prev, [collectionId]: false }));
        });
    });
  }, [authLoading, authToken, collectionPromptDetails, selectedToolCollectionIds]);

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      if (authLoading) {
        return;
      }
      if (!authToken) {
        setModelCatalog([]);
        setModelsLoading(false);
        setModelsError("Sign in to load models.");
        return;
      }
      if (!openrouterConfigured) {
        setModelCatalog([]);
        setModelsLoading(false);
        setModelsError("Add your OpenRouter API key in Settings to load models.");
        return;
      }
      setModelsLoading(true);
      try {
        const items = await listModels(authToken || undefined);
        if (!cancelled) {
          setModelCatalog(items);
          setModelsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setModelsError(error instanceof Error ? error.message : "Unable to load model metadata.");
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };
    loadModels();
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken, openrouterConfigured]);

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

  const currentModelInfo = useMemo(() => {
    const lookupId = activeModelId;
    if (!lookupId) return null;
    return (
      modelCatalog.find((model) => model.id === lookupId || model.canonical_slug === lookupId) ??
      null
    );
  }, [activeModelId, modelCatalog]);

  const providerModelSlug = useMemo(() => {
    const slugSource = currentModelInfo?.canonical_slug ?? currentModelInfo?.id ?? null;
    return sanitizeModelSlug(slugSource);
  }, [currentModelInfo?.canonical_slug, currentModelInfo?.id]);

  const supportedParameterKeys = useMemo(() => {
    const supported = new Set<ModelParameterKey>();
    if (!currentModelInfo) {
      return supported;
    }
    (currentModelInfo.supported_parameters || []).forEach((param) => {
      const normalized = param.toLowerCase();
      if (normalized in PARAMETER_DEFINITION_MAP) {
        supported.add(normalized as ModelParameterKey);
      }
    });
    return supported;
  }, [currentModelInfo]);

  const visibleParameterDefinitions = useMemo(
    () => PARAMETER_DEFINITIONS.filter((definition) => supportedParameterKeys.has(definition.key)),
    [supportedParameterKeys],
  );

  const activeParameterCount = useMemo(() => {
    return Object.keys(parameterOverrides).filter((key) =>
      supportedParameterKeys.has(key as ModelParameterKey),
    ).length;
  }, [parameterOverrides, supportedParameterKeys]);

  const providerPayload = useMemo<ProviderPreferences>(() => {
    const payload: ProviderPreferences = {};
    if (providerForm.order.length > 0) {
      payload.order = providerForm.order;
    }
    if (providerForm.only.length > 0) {
      payload.only = providerForm.only;
    }
    if (providerForm.ignore.length > 0) {
      payload.ignore = providerForm.ignore;
    }
    if (providerForm.quantizations.length > 0) {
      payload.quantizations = providerForm.quantizations.map((entry) => entry.toLowerCase());
    }
    if (providerForm.sort) {
      payload.sort = providerForm.sort as ProviderSortOption;
    }
    if (!providerForm.allowFallbacks) {
      payload.allow_fallbacks = false;
    }
    if (providerForm.requireParameters) {
      payload.require_parameters = true;
    }
    if (providerForm.dataCollection === "deny") {
      payload.data_collection = "deny";
    }
    if (providerForm.zdr) {
      payload.zdr = true;
    }
    if (providerForm.enforceDistillableText) {
      payload.enforce_distillable_text = true;
    }
    const maxPrice: ProviderPreferences["max_price"] = {};
    const promptPrice = parsePriceInput(providerForm.maxPrompt);
    if (promptPrice !== null) {
      maxPrice.prompt = promptPrice;
    }
    const completionPrice = parsePriceInput(providerForm.maxCompletion);
    if (completionPrice !== null) {
      maxPrice.completion = completionPrice;
    }
    const requestPrice = parsePriceInput(providerForm.maxRequest);
    if (requestPrice !== null) {
      maxPrice.request = requestPrice;
    }
    const imagePrice = parsePriceInput(providerForm.maxImage);
    if (imagePrice !== null) {
      maxPrice.image = imagePrice;
    }
    if (maxPrice && Object.keys(maxPrice).length > 0) {
      payload.max_price = maxPrice;
    }
    return payload;
  }, [providerForm]);

  const providerRuleCount = useMemo(() => Object.keys(providerPayload).length, [providerPayload]);

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
    if (!providerModelSlug) {
      setProviderDirectory(null);
      setProviderDirectoryError(null);
      setProviderDirectoryLoading(false);
      return;
    }
    if (authLoading) {
      return;
    }
    if (!authToken) {
      setProviderDirectory(null);
      setProviderDirectoryError("Sign in to load providers.");
      setProviderDirectoryLoading(false);
      return;
    }
    if (!openrouterConfigured) {
      setProviderDirectory(null);
      setProviderDirectoryError("Add your OpenRouter API key in Settings to load providers.");
      setProviderDirectoryLoading(false);
      return;
    }
    const [author, ...rest] = providerModelSlug.split("/");
    const slugPart = rest.join("/");
    if (!author || !slugPart) {
      setProviderDirectory(null);
      return;
    }
    let cancelled = false;
    setProviderDirectoryLoading(true);
    setProviderDirectoryError(null);
    listModelEndpoints(authToken || undefined, author, slugPart)
      .then((response) => {
        if (cancelled) return;
        setProviderDirectory(response.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unable to load provider catalog.";
        setProviderDirectoryError(message);
        setProviderDirectory(null);
      })
      .finally(() => {
        if (!cancelled) {
          setProviderDirectoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken, openrouterConfigured, providerModelSlug]);

  useEffect(() => {
    setProviderSearchTerm("");
  }, [providerModelSlug]);

  const markProgrammaticScroll = useCallback((duration = 150) => {
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollRef.current = true;
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, duration);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (!endRef.current) {
        return;
      }
      if (scrollAnimationFrameRef.current) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
      markProgrammaticScroll(behavior === "smooth" ? 600 : 150);
      scrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior });
        scrollAnimationFrameRef.current = null;
      });
    },
    [markProgrammaticScroll],
  );

  useEffect(() => {
    return () => {
      if (scrollAnimationFrameRef.current) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!autoScrollEnabled) {
      return;
    }
    scrollToBottom("smooth");
    const timeout = setTimeout(() => {
      scrollToBottom("smooth");
    }, 100);
    return () => clearTimeout(timeout);
  }, [autoScrollEnabled, chatEntryOrder, liveReasoningSegments, liveResponse, scrollToBottom]);

  useEffect(() => {
    setAutoScrollEnabled(true);
  }, [selectedSessionId]);

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

  useEffect(
    () => () => {
      if (programmaticScrollTimeoutRef.current) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (liveReasoningSegments.length > 0) {
      setPersistedLiveReasoningSegments(liveReasoningSegments);
    }
  }, [liveReasoningSegments]);

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

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    if (programmaticScrollRef.current) {
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 12) {
      if (autoScrollEnabled) {
        setAutoScrollEnabled(false);
      }
      return;
    }
    if (!autoScrollEnabled && distanceFromBottom <= 2) {
      setAutoScrollEnabled(true);
    }
  }, [autoScrollEnabled]);

  const handleReenableAutoScroll = useCallback(() => {
    setAutoScrollEnabled(true);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

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

  const pollSessionHistory = useCallback(
    async (sessionId: string) => {
      if (!authToken) return;
      if (isStreamingResponseRef.current) {
        return;
      }
      try {
        const history = await getChatHistory(authToken, sessionId);
        if (activePollingSession.current !== sessionId) {
          return;
        }
        if (isStreamingResponseRef.current) {
          return;
        }
        // Hydrate instead of queueing pending reveals so previously streamed bubbles
        // stay mounted while their persisted counterparts arrive.
        syncMessages(history, { hydrate: true });
        setToolTraces(deriveToolTraces(history));
        setUsage(calculateSessionUsage(history));
      } catch {
        // swallow transient polling errors
      }
    },
    [authToken, deriveToolTraces, syncMessages],
  );

  const stopProgressPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    activePollingSession.current = null;
  }, []);

  const startProgressPolling = useCallback(
    (sessionId: string) => {
      if (!authToken) return;
      activePollingSession.current = sessionId;
      void pollSessionHistory(sessionId);
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
      pollIntervalRef.current = window.setInterval(() => {
        void pollSessionHistory(sessionId);
      }, PROGRESS_POLL_INTERVAL);
    },
    [authToken, pollSessionHistory],
  );

  useEffect(() => () => stopProgressPolling(), [stopProgressPolling]);

  useEffect(() => {
    if (!activePollingSession.current) {
      return;
    }
    if (!selectedSessionId || activePollingSession.current !== selectedSessionId) {
      stopProgressPolling();
    }
  }, [selectedSessionId, stopProgressPolling]);

  const toolTraceMap = useMemo(() => {
    const map = new Map<string, ToolCallTrace>();
    toolTraces.forEach((trace) => map.set(trace.id, trace));
    return map;
  }, [toolTraces]);

  const chatEntries = useMemo<ChatEntry[]>(() => {
    const dedupedOptimistic = optimisticMessages.filter((optimistic) => {
      const trimmedOptimistic = optimistic.content.trim();
      if (!trimmedOptimistic) {
        return false;
      }
      return !messages.some((message) =>
        isOptimisticDuplicate(optimistic, message, messageOrderRef.current),
      );
    });
    const combined = [...messages, ...dedupedOptimistic].sort((a, b) => {
      const aOrder = messageOrderRef.current.get(a.id);
      const bOrder = messageOrderRef.current.get(b.id);
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) {
        return -1;
      }
      if (bOrder !== undefined) {
        return 1;
      }
      const aTime = Date.parse(a.created_at) || 0;
      const bTime = Date.parse(b.created_at) || 0;
      if (aTime === bTime) {
        return a.id.localeCompare(b.id);
      }
      return aTime - bTime;
    });

    return combined.flatMap((message) => {
      const entryList: ChatEntry[] = [];
      const createdAt = message.created_at;
      const trimmedContent = message.content?.trim() ?? "";
      const isAssistant = message.role === "assistant";
      const isUser = message.role === "user";
      const isSystem = message.role === "system";
      const isTool = message.role === "tool";
      const isToolCallPlaceholder =
        isAssistant &&
        !trimmedContent &&
        Array.isArray(message.tool_payload?.tool_calls) &&
        message.tool_payload?.tool_calls.length > 0;

      if (isAssistant) {
        const reasoningSegments = getPersistedReasoningSegments(
          `${message.id}-assistant-reasoning`,
          normalizeReasoningSegments(message.reasoning_trace),
        );
        const assistantSegments = reasoningSegments.filter(
          (segment) => !isToolReasoningSegment(segment),
        );
        if (assistantSegments.length > 0) {
          entryList.push({
            id: `${message.id}:reasoning:assistant`,
            type: "reasoning",
            messageId: message.id,
            source: "assistant",
            title: "Reasoning",
            subtitle: "Assistant reasoning",
            segments: assistantSegments,
            createdAt,
          });
        }
      }

      if (isTool) {
        const trace = message.tool_call_id ? toolTraceMap.get(message.tool_call_id) : null;
        const toolSegments = getPersistedReasoningSegments(
          `${message.id}-tool-reasoning`,
          trace
            ? normalizeReasoningSegments(trace.reasoning)
            : normalizeReasoningSegments(message.reasoning_trace),
        );
        const rawPayload =
          (message.tool_payload as Record<string, unknown> | null) ??
          safeParseJSON(message.content) ??
          {};
        const payloadRecord: Record<string, unknown> = {
          ...coerceRecord(rawPayload),
          ...(trace
            ? {
                arguments: trace.arguments,
                response: trace.response,
              }
            : {}),
        };
        const collectionName =
          trace?.collection_name ||
          (typeof payloadRecord.collection_name === "string"
            ? payloadRecord.collection_name
            : null);
        const baseToolLabel = formatToolLabel(trace?.name || message.tool_name || "Tool");
        const toolLabel = collectionName ? `${baseToolLabel} · ${collectionName}` : baseToolLabel;
        if (toolSegments.length > 0) {
          entryList.push({
            id: `${message.id}:reasoning:tool`,
            type: "reasoning",
            messageId: message.id,
            source: "tool",
            title: "Reasoning",
            subtitle: toolLabel,
            segments: toolSegments,
            relatedToolLabel: toolLabel,
            createdAt,
          });
        }
        const argsRecord = coerceRecord(payloadRecord.arguments ?? {});
        const responseRecord = coerceRecord(payloadRecord.response ?? payloadRecord);
        entryList.push({
          id: `${message.id}:tool`,
          type: "tool-call",
          message,
          messageId: message.id,
          label: toolLabel,
          args: argsRecord,
          response: responseRecord,
          rawPayload: payloadRecord,
          createdAt,
        });
        return entryList;
      }

      if (!isToolCallPlaceholder && (isUser || isAssistant || isSystem)) {
        entryList.push({
          id: message.id,
          type: isAssistant ? "assistant" : isUser ? "user" : "system",
          message,
          messageId: message.id,
          content: trimmedContent || "No response captured.",
          createdAt,
        });
      }

      return entryList;
    });
  }, [getPersistedReasoningSegments, messages, optimisticMessages, toolTraceMap]);

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

  const toolsEnabled = selectedToolCollectionIds.length > 0;
  const chatInputPlaceholder = toolsEnabled
    ? "Ask about the selected collections…"
    : "Ask anything…";
  const toolReadyModels = useMemo(() => {
    if (!toolsEnabled) {
      return modelCatalog;
    }
    return modelCatalog.filter((model) =>
      (model.supported_parameters || []).some((param) => param.toLowerCase() === "tools"),
    );
  }, [modelCatalog, toolsEnabled]);

  const filteredModelCatalog = useMemo(() => {
    const query = modelSearchTerm.trim().toLowerCase();
    if (!query) return toolReadyModels;
    return toolReadyModels.filter((model) => {
      const haystack = [model.name, model.id, model.canonical_slug, model.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [modelSearchTerm, toolReadyModels]);

  const sortedModelCatalog = useMemo(
    () => sortChatModels(filteredModelCatalog, modelSortOption),
    [filteredModelCatalog, modelSortOption],
  );

  const selectedModelKey = useMemo(() => activeModelId || "", [activeModelId]);

  const substitutePromptVariables = useCallback(
    (templateValue: string, context?: Record<string, string>) => {
      if (!templateValue) return "";
      if (!context) return templateValue;
      return templateValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey) => {
        const key = String(rawKey).trim();
        return context?.[key] ?? `{{${key}}}`;
      });
    },
    [],
  );

  const basePromptTemplate = useMemo(() => {
    return basePromptDraft || basePromptDetails?.template || "";
  }, [basePromptDetails?.template, basePromptDraft]);

  const basePromptPreview = useMemo(() => {
    return substitutePromptVariables(basePromptTemplate, basePromptDetails?.context);
  }, [basePromptDetails?.context, basePromptTemplate, substitutePromptVariables]);

  const toolPromptPreviews = useMemo(() => {
    return selectedToolCollections
      .map((collection) => {
        const details = collectionPromptDetails[collection.id];
        const draft = collectionPromptDrafts[collection.id] ?? details?.template ?? "";
        return substitutePromptVariables(draft, details?.context);
      })
      .filter((section) => section.trim().length > 0);
  }, [
    collectionPromptDetails,
    collectionPromptDrafts,
    selectedToolCollections,
    substitutePromptVariables,
  ]);

  const promptPreviewMarkdown = useMemo(() => {
    return [basePromptPreview, ...toolPromptPreviews]
      .map((section) => section.trim())
      .filter(Boolean)
      .join("\n\n");
  }, [basePromptPreview, toolPromptPreviews]);

  const basePromptHasChanges = useMemo(() => {
    if (!basePromptDetails) {
      return Boolean(basePromptDraft);
    }
    return basePromptDraft !== (basePromptDetails.template ?? "");
  }, [basePromptDetails, basePromptDraft]);

  const promptSections = useMemo(() => {
    const sections: Array<{
      id: string;
      label: string;
      scope: "base" | "collection";
      details: PromptDetails | null;
      draft: string;
      hasChanges: boolean;
      saving: boolean;
      error: string | null;
    }> = [
      {
        id: "base",
        label: "Base",
        scope: "base" as const,
        details: basePromptDetails,
        draft: basePromptDraft,
        hasChanges: basePromptHasChanges,
        saving: Boolean(promptSavingBySection.base),
        error: basePromptError,
      },
    ];
    selectedToolCollections.forEach((collection) => {
      const details = collectionPromptDetails[collection.id] ?? null;
      const draft = collectionPromptDrafts[collection.id] ?? details?.template ?? "";
      const hasChanges = details ? draft !== (details.template ?? "") : draft.trim().length > 0;
      sections.push({
        id: collection.id,
        label: collection.name,
        scope: "collection" as const,
        details,
        draft,
        hasChanges,
        saving: Boolean(promptSavingBySection[collection.id]),
        error: collectionPromptErrors[collection.id] ?? null,
      });
    });
    return sections;
  }, [
    basePromptDetails,
    basePromptDraft,
    basePromptError,
    basePromptHasChanges,
    collectionPromptDetails,
    collectionPromptDrafts,
    collectionPromptErrors,
    promptSavingBySection,
    selectedToolCollections,
  ]);

  const promptSectionsSummary = useMemo(() => {
    return promptSections.map((section) => ({
      id: section.id,
      label: section.label,
      scope: section.scope,
      isCustom: Boolean(section.details?.is_custom),
    }));
  }, [promptSections]);

  const promptLoading =
    basePromptLoading ||
    selectedToolCollectionIds.some((collectionId) => collectionPromptLoading[collectionId]);
  const promptError =
    basePromptError ??
    selectedToolCollectionIds
      .map((collectionId) => collectionPromptErrors[collectionId])
      .find((value) => Boolean(value)) ??
    null;
  const promptGeneratedAt = basePromptDetails?.context?.["datetime.iso"] ?? null;

  useEffect(() => {
    if (
      activePromptSectionId !== "base" &&
      !selectedToolCollectionIds.includes(activePromptSectionId)
    ) {
      setActivePromptSectionId("base");
    }
  }, [activePromptSectionId, selectedToolCollectionIds]);

  const liveReasoningSegmentsRef = useRef<ReasoningTraceSegment[]>([]);
  const streamedReasoningAllRef = useRef<ReasoningTraceSegment[]>([]);
  const streamReasoningPhaseRef = useRef(0);

  useEffect(() => {
    liveReasoningSegmentsRef.current = liveReasoningSegments;
  }, [liveReasoningSegments]);

  const finalizeLiveReasoningBlock = useCallback(() => {
    const currentSegments = liveReasoningSegmentsRef.current;
    if (currentSegments.length === 0) {
      return;
    }
    streamedReasoningAllRef.current = [...streamedReasoningAllRef.current, ...currentSegments];
    const phaseIndex = streamReasoningPhaseRef.current;
    setLiveReasoningBlocks((prev) => {
      const next = [...prev];
      next[phaseIndex] = currentSegments;
      return next;
    });
    setLiveReasoningSegments([]);
    setPersistedLiveReasoningSegments([]);
  }, []);

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
    setLiveToolEvents((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const next = prev.filter((event) => !event.id || !persistedToolIds.has(event.id));
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

  const applyChatResponse = useCallback(
    (response: ChatCompletionPayload) => {
      finalizeLiveReasoningBlock();
      const streamedReasoningSegments = streamedReasoningAllRef.current;
      setLiveResponse("");
      setIsStreamingResponse(false);
      setPersistedLiveReasoningSegments(streamedReasoningSegments);
      setLiveReasoningSegments([]);
      setLiveReasoningBlocks([]);
      streamedReasoningAllRef.current = [];
      const finalAssistant = [...response.messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      setFinalStreamAssistantId(finalAssistant?.id ?? null);
      const streamKey = activeStreamEntryKeyRef.current;
      if (finalAssistant?.id && streamKey) {
        setStreamEntryKeyMap((prev) => ({ ...prev, [finalAssistant.id]: streamKey }));
      }
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
      contextWindow,
      deriveToolTraces,
      finalizeLiveReasoningBlock,
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

    setLiveResponse("");
    setIsStreamingResponse(false);
    resetLiveReasoningState();
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
        setFinalStreamAssistantId(null);
        setStreamEntryKeyMap({});
        setLiveResponse("");
        setIsStreamingResponse(false);
        setActiveStreamEntryKey(null);
        activeStreamEntryKeyRef.current = null;
        resetLiveReasoningState();
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
      resetLiveReasoningState,
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
    setFinalStreamAssistantId(null);
    setStreamEntryKeyMap({});
    setUsage(null);
    setContextConsumed(0);
    setDraft("");
    setLiveResponse("");
    setIsStreamingResponse(false);
    setActiveStreamEntryKey(null);
    activeStreamEntryKeyRef.current = null;
    resetLiveReasoningState();
    setEditingMessageId(null);
    setEditingDraft("");
    setOptimisticMessages([]);
    navigateToChat(null, selectedToolCollectionIds);
  };

  const toggleToolCollection = useCallback(
    (collectionId: string) => {
      toolCollectionsDirtyRef.current = true;
      setSelectedToolCollectionIds((prev) => {
        const next = prev.includes(collectionId)
          ? prev.filter((id) => id !== collectionId)
          : [...prev, collectionId];
        if (selectedSessionId) {
          setSessions((sessionsPrev) =>
            sessionsPrev.map((session) =>
              session.id === selectedSessionId
                ? { ...session, tool_collection_ids: next }
                : session,
            ),
          );
        }
        return next;
      });
    },
    [selectedSessionId],
  );

  const clearToolCollections = useCallback(() => {
    toolCollectionsDirtyRef.current = true;
    setSelectedToolCollectionIds([]);
    if (selectedSessionId) {
      setSessions((sessionsPrev) =>
        sessionsPrev.map((session) =>
          session.id === selectedSessionId ? { ...session, tool_collection_ids: [] } : session,
        ),
      );
    }
  }, [selectedSessionId]);

  const handleHistoryFilterChange = useCallback(
    (collectionIds: string[], includeUnassigned: boolean) => {
      historyFilterTouchedRef.current = true;
      setHistoryFilterCollectionIds(collectionIds);
      setHistoryFilterIncludeUnassigned(includeUnassigned);
    },
    [],
  );

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

  const handlePromptEditorOpen = useCallback(() => {
    if (promptSections.length > 0) {
      const isActiveValid = promptSections.some((section) => section.id === activePromptSectionId);
      if (!isActiveValid) {
        setActivePromptSectionId("base");
      }
    }
    setPromptEditorOpen(true);
    window.setTimeout(() => {
      promptEditorRef.current?.focus();
    }, 20);
  }, [activePromptSectionId, promptSections]);

  const handlePromptEditorClose = useCallback(() => {
    setPromptEditorOpen(false);
  }, []);

  const updatePromptDraft = useCallback((sectionId: string, updater: (value: string) => string) => {
    if (sectionId === "base") {
      setBasePromptDraft(updater);
      return;
    }
    setCollectionPromptDrafts((prev) => {
      const current = prev[sectionId] ?? "";
      return { ...prev, [sectionId]: updater(current) };
    });
  }, []);

  const handleInsertPromptVariable = useCallback(
    (sectionId: string, variableName: string) => {
      const insertion = `{{${variableName}}}`;
      updatePromptDraft(sectionId, (prev) => {
        const textarea = promptEditorRef.current;
        if (textarea) {
          const start = textarea.selectionStart ?? prev.length;
          const end = textarea.selectionEnd ?? prev.length;
          const next = prev.slice(0, start) + insertion + prev.slice(end);
          window.requestAnimationFrame(() => {
            const cursor = start + insertion.length;
            textarea.selectionStart = cursor;
            textarea.selectionEnd = cursor;
            textarea.focus();
          });
          return next;
        }
        const spacer = prev.endsWith(" ") || prev.endsWith("\n") || prev.length === 0 ? "" : " ";
        return `${prev}${spacer}${insertion}`;
      });
    },
    [updatePromptDraft],
  );

  const handlePromptReset = useCallback(
    (sectionId: string) => {
      updatePromptDraft(sectionId, () => "");
      window.requestAnimationFrame(() => {
        promptEditorRef.current?.focus();
      });
    },
    [updatePromptDraft],
  );

  const handlePromptSave = useCallback(
    async (sectionId: string) => {
      if (!authToken) {
        if (sectionId === "base") {
          setBasePromptError("Sign in to update the system prompt.");
        } else {
          setCollectionPromptErrors((prev) => ({
            ...prev,
            [sectionId]: "Sign in to update the system prompt.",
          }));
        }
        return;
      }
      setPromptSavingBySection((prev) => ({ ...prev, [sectionId]: true }));
      if (sectionId === "base") {
        setBasePromptError(null);
        try {
          const updated = await updateBasePrompt(authToken, basePromptDraft);
          setBasePromptDetails(updated);
          setBasePromptDraft(updated.template ?? "");
          setPromptEditorOpen(false);
        } catch (error) {
          setBasePromptError(
            error instanceof Error
              ? error.message
              : "Unable to update the system prompt right now.",
          );
        } finally {
          setPromptSavingBySection((prev) => ({ ...prev, [sectionId]: false }));
        }
        return;
      }
      setCollectionPromptErrors((prev) => ({ ...prev, [sectionId]: null }));
      try {
        const draft = collectionPromptDrafts[sectionId] ?? "";
        const updated = await updateCollectionPrompt(authToken, sectionId, draft);
        setCollectionPromptDetails((prev) => ({ ...prev, [sectionId]: updated }));
        setCollectionPromptDrafts((prev) => ({
          ...prev,
          [sectionId]: updated.template ?? "",
        }));
        setPromptEditorOpen(false);
      } catch (error) {
        setCollectionPromptErrors((prev) => ({
          ...prev,
          [sectionId]:
            error instanceof Error
              ? error.message
              : "Unable to update the system prompt right now.",
        }));
      } finally {
        setPromptSavingBySection((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [authToken, basePromptDraft, collectionPromptDrafts],
  );

  const handlePromptSectionSelect = useCallback((sectionId: string) => {
    setActivePromptSectionId(sectionId);
  }, []);

  const handlePromptDraftChange = useCallback(
    (sectionId: string, value: string) => {
      updatePromptDraft(sectionId, () => value);
    },
    [updatePromptDraft],
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

  const updateParameterValue = useCallback(
    (key: ModelParameterKey, value?: ParameterValue | null) => {
      setParameterOverrides((prev) => {
        const next = { ...prev };
        if (value === undefined || value === null) {
          delete next[key];
        } else if (typeof value === "string" && value.trim() === "") {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    [],
  );

  const handleNumberParameterChange = useCallback(
    (key: ModelParameterKey, rawValue: string, asInteger = false) => {
      if (rawValue === "") {
        updateParameterValue(key, undefined);
        return;
      }
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed)) {
        updateParameterValue(key, undefined);
        return;
      }
      updateParameterValue(key, asInteger ? Math.round(parsed) : parsed);
    },
    [updateParameterValue],
  );

  const handleBooleanParameterChange = useCallback(
    (key: ModelParameterKey, checked: boolean) => {
      updateParameterValue(key, checked ? true : undefined);
    },
    [updateParameterValue],
  );

  const handleTextParameterChange = useCallback(
    (key: ModelParameterKey, value: string) => {
      updateParameterValue(key, value);
    },
    [updateParameterValue],
  );

  const handleSelectParameterChange = useCallback(
    (key: ModelParameterKey, value: string) => {
      updateParameterValue(key, value ? value : undefined);
    },
    [updateParameterValue],
  );

  const handleClearParameter = useCallback(
    (key: ModelParameterKey) => {
      updateParameterValue(key, undefined);
    },
    [updateParameterValue],
  );

  const resetAllParameters = useCallback(() => {
    setParameterOverrides({});
  }, []);

  const formatDefaultParameter = useCallback(
    (key: ModelParameterKey) => {
      if (!currentModelInfo?.default_parameters) return null;
      const rawValue = currentModelInfo.default_parameters[key];
      if (rawValue === undefined || rawValue === null) return null;
      if (Array.isArray(rawValue)) {
        return rawValue.join(", ");
      }
      if (typeof rawValue === "object") {
        try {
          return JSON.stringify(rawValue);
        } catch {
          return String(rawValue);
        }
      }
      return String(rawValue);
    },
    [currentModelInfo],
  );

  const buildParameterPayload = useCallback(
    (overrides: ParameterOverrides = parameterOverrides, modelIdOverride?: string | null) => {
      const targetModelId = modelIdOverride ?? currentModelInfo?.id ?? null;
      const modelInfo =
        targetModelId === currentModelInfo?.id
          ? currentModelInfo
          : (modelCatalog.find(
              (model) => model.id === targetModelId || model.canonical_slug === targetModelId,
            ) ?? null);
      if (!modelInfo) {
        return {};
      }
      const supportedSet = new Set(
        (modelInfo.supported_parameters || []).map((param) => param.toLowerCase()),
      );
      const payload: Record<string, unknown> = {};
      Object.entries(overrides).forEach(([key, rawValue]) => {
        const normalizedKey = key.toLowerCase();
        if (!supportedSet.has(normalizedKey)) {
          return;
        }
        if (rawValue === undefined || rawValue === null) {
          return;
        }
        if (normalizedKey === "reasoning") {
          if (typeof rawValue === "string") {
            const trimmedReasoning = rawValue.trim().toLowerCase();
            if (!trimmedReasoning) {
              return;
            }
            payload[normalizedKey] = { effort: trimmedReasoning };
            return;
          }
          if (typeof rawValue === "object") {
            payload[normalizedKey] = rawValue;
          }
          return;
        }
        if (typeof rawValue === "string") {
          const trimmed = rawValue.trim();
          if (!trimmed) {
            return;
          }
          payload[normalizedKey] = trimmed;
          return;
        }
        payload[normalizedKey] = rawValue;
      });
      return payload;
    },
    [currentModelInfo, modelCatalog, parameterOverrides],
  );

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
      setLiveResponse("");
      setIsStreamingResponse(false);
      isStreamingResponseRef.current = false;
      toolCollectionsDirtyRef.current = false;
      setFinalStreamAssistantId(null);
      setLiveToolEvents([]);
      setLiveToolOrder([]);
      setLiveToolPhaseById({});
      resetLiveReasoningState();
      streamReasoningPhaseRef.current = 0;
      setLiveReasoningPhase(0);
      streamedReasoningAllRef.current = [];
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
          setIsStreamingResponse(true);
          isStreamingResponseRef.current = true;
          const streamKey = `stream-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          setActiveStreamEntryKey(streamKey);
          activeStreamEntryKeyRef.current = streamKey;
          result = await streamChat(authToken, requestPayload, {
            signal: controller.signal,
            onToken: (token) => {
              if (token) {
                setLiveResponse((prev) => `${prev}${token}`);
              }
            },
            onReasoning: (segments) => {
              setLiveReasoningSegments(segments ?? []);
            },
            onToolCall: (event) => {
              finalizeLiveReasoningBlock();
              const rawId =
                typeof event.id === "string" && event.id.trim() ? event.id.trim() : null;
              const toolId = rawId ?? makeToolId();
              const phaseIndex = streamReasoningPhaseRef.current;
              setLiveToolPhaseById((prev) =>
                prev[toolId] === phaseIndex ? prev : { ...prev, [toolId]: phaseIndex },
              );
              setLiveToolOrder((prev) => (prev.includes(toolId) ? prev : [...prev, toolId]));
              streamReasoningPhaseRef.current = phaseIndex + 1;
              setLiveReasoningPhase(phaseIndex + 1);
              upsertLiveToolEvent({
                id: toolId,
                name: event.name,
                arguments: event.arguments,
                reasoning: event.reasoning,
                collection_id: event.collection_id,
                collection_name: event.collection_name,
              });
            },
            onToolResult: (event) => {
              const rawId =
                typeof event.id === "string" && event.id.trim() ? event.id.trim() : null;
              const toolId = rawId ?? makeToolId();
              setLiveToolOrder((prev) => (prev.includes(toolId) ? prev : [...prev, toolId]));
              setLiveToolPhaseById((prev) => {
                if (prev[toolId] !== undefined) {
                  return prev;
                }
                const fallbackPhase = Math.max(0, streamReasoningPhaseRef.current - 1);
                return { ...prev, [toolId]: fallbackPhase };
              });
              upsertLiveToolEvent({
                id: toolId,
                name: event.name,
                arguments: event.arguments,
                response: event.response,
                reasoning: event.reasoning,
                collection_id: event.collection_id,
                collection_name: event.collection_name,
              });
            },
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
        setIsStreamingResponse(false);
        isStreamingResponseRef.current = false;
        const shouldClearLiveState = !isAbortError(error);
        if (shouldClearLiveState) {
          setLiveResponse("");
          resetLiveReasoningState();
        }
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
      finalizeLiveReasoningBlock,
      pineconeConfigured,
      selectedToolCollectionIds,
      setActiveStreamEntryKey,
      resetLiveReasoningState,
      startProgressPolling,
      stopProgressPolling,
      toolsEnabled,
      upsertLiveToolEvent,
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
