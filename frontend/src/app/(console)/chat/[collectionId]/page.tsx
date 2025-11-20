'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowDown, ArrowLeft, PanelLeftOpen, PanelRightOpen, PlusCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/panel';
import { Loader } from '@/components/ui/loader';
import { HistoryPanel } from '@/components/chat-studio/HistoryPanel';
import {
  chatWithCollection,
  deleteChatSession,
  fetchCollections,
  fetchDocuments,
  getChatHistory,
  getCollectionPrompt,
  listChatSessions,
  listModelEndpoints,
  listModels,
  streamChatWithCollection,
  updateCollectionPrompt,
} from '@/lib/api';
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
  CollectionPromptDetails,
  ModelEndpointDirectory,
  ModelInfo,
  ProviderPreferences,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';
import { ChatInput, PromptEditorOverlay } from '@/components/chat-studio';
import { TelemetryPanel } from '@/components/chat-studio/telemetry/TelemetryPanel';
import { formatToolLabel } from '@/components/chat-studio/Tooling';
import { ChatTimeline } from './components/ChatTimeline';
import {
  coerceRecord,
  markdownComponents,
  normalizeReasoningSegments,
  parsePriceInput,
  sanitizeFileName,
  sanitizeModelSlug,
  safeParseJSON,
} from './chat-utils';
import type { ChatEntry } from './chat-types';
import type {
  ModelParameterKey,
  ParameterDefinition,
  ParameterOverrides,
  ParameterValue,
} from '@/lib/chat-parameters';
import { PARAMETER_DEFINITIONS } from '@/lib/chat-parameters';
import type { ProviderFormState } from '@/components/chat-studio/types';

const samplePrompts = [
  'Give me the latest ingestion summary with citations.',
  'What changed in the newest document batch?',
  'Draft next steps using the last three answers.',
  'List any flagged chunks that might need review.',
];

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
    if (typeof window === 'undefined') {
      return defaultValue;
    }
    const stored = window.localStorage.getItem(key);
    return stored === null ? defaultValue : stored === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(key, value ? 'true' : 'false');
  }, [key, value]);

  return [value, setValue] as const;
};

const createDefaultProviderForm = (): ProviderFormState => ({
  sort: '',
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: false,
  dataCollection: 'allow',
  zdr: false,
  enforceDistillableText: false,
  maxPrompt: '',
  maxCompletion: '',
  maxRequest: '',
  maxImage: '',
});

const deriveToolTracesFromMessages = (items: ChatMessage[]): ToolCallTrace[] =>
  items
    .filter((message) => message.role === 'tool')
    .map((message) => {
      const payload =
        (message.tool_payload as Record<string, unknown> | null) ?? safeParseJSON(message.content) ?? {};
      const payloadRecord = coerceRecord(payload);
      const argsValue = payloadRecord.arguments ?? {};
      const responseValue = payloadRecord.response ?? payloadRecord;
      const reasoningSegments = normalizeReasoningSegments(message.reasoning_trace);
      return {
        id: message.tool_call_id || message.id,
        name: message.tool_name || 'tool_call',
        arguments: coerceRecord(argsValue),
        response: coerceRecord(responseValue),
        reasoning: reasoningSegments.length > 0 ? { segments: reasoningSegments } : null,
      } satisfies ToolCallTrace;
    });

const calculateSessionUsage = (items: ChatMessage[]): UsageBreakdown | null => {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalReasoningTokens = 0;
  let totalCost = 0;
  let hasUsage = false;

  for (const message of items) {
    if (message.usage) {
      hasUsage = true;
      if (message.usage.prompt_tokens != null) {
        totalPromptTokens += message.usage.prompt_tokens;
      }
      if (message.usage.completion_tokens != null) {
        totalCompletionTokens += message.usage.completion_tokens;
      }
      if (message.usage.total_tokens != null) {
        totalTokens += message.usage.total_tokens;
      }
      if (message.usage.reasoning_tokens != null) {
        totalReasoningTokens += message.usage.reasoning_tokens;
      }
      if (message.usage.cost != null) {
        totalCost += message.usage.cost;
      }
    }
  }

  if (!hasUsage) {
    return null;
  }

  return {
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    total_tokens: totalTokens,
    reasoning_tokens: totalReasoningTokens,
    cost: totalCost,
  };
};

const attachUsageToLastAssistantMessage = (
  messages: ChatMessage[],
  usage: UsageBreakdown | null,
): ChatMessage[] => {
  if (!usage) {
    return messages;
  }
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!lastAssistant || lastAssistant.usage) {
    return messages;
  }
  return messages.map((message) =>
    message.id === lastAssistant.id ? { ...message, usage } : message,
  );
};

const isToolReasoningSegment = (segment: ReasoningTraceSegment): boolean => {
  const typeValue = typeof segment.type === 'string' ? segment.type.toLowerCase() : '';
  if (
    typeValue === 'tool_call' ||
    typeValue === 'tool_use' ||
    typeValue === 'tool_request' ||
    typeValue === 'call_tool' ||
    typeValue === 'function_call'
  ) {
    return true;
  }
  return Boolean(segment.call || segment.function || segment.tool_call_id || segment.tool_name);
};

const generateClientSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    if (char === 'x') {
      return rand.toString(16);
    }
    // Ensure the variant bits are 10xx for UUID v4 compatibility
    return ((rand & 0x3) | 0x8).toString(16);
  });
};

const generateClientMessageId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `client-${crypto.randomUUID()}`;
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const CHAT_INPUT_MIN_HEIGHT = 40;
const CHAT_INPUT_MAX_HEIGHT = 160;
const PROGRESS_POLL_INTERVAL = 800;

const sortMessagesChronologically = (messages: ChatMessage[]) => {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(a.created_at) || 0;
    const bTime = Date.parse(b.created_at) || 0;
    if (aTime === bTime) {
      return a.id.localeCompare(b.id);
    }
    return aTime - bTime;
  });
};

const mergeMessageHistory = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  if (incoming.length === 0) {
    return existing;
  }
  const mergedMap = new Map<string, ChatMessage>();
  existing.forEach((message) => mergedMap.set(message.id, message));
  incoming.forEach((message) => mergedMap.set(message.id, message));
  return sortMessagesChronologically(Array.from(mergedMap.values()));
};

export default function ChatStudioExperience() {
  const params = useParams<{ collectionId: string }>();
  const collectionId = params?.collectionId ?? '';
  const router = useRouter();
  const { token } = useAuth();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [documentCount, setDocumentCount] = useState(0);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolCallTrace[]>([]);
  const [chatEntryOrder, setChatEntryOrder] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(0);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = usePersistentToggle('chat.historyOpen', true);
  const [telemetryOpen, setTelemetryOpen] = usePersistentToggle('chat.telemetryOpen', true);
  const [modelSelectorOpen, setModelSelectorOpen] = usePersistentToggle(
    'chat.telemetry.modelsOpen',
    true,
  );
  const [systemPromptOpen, setSystemPromptOpen] = usePersistentToggle('chat.telemetry.promptOpen', true);
  const [vitalsOpen, setVitalsOpen] = usePersistentToggle('chat.telemetry.vitalsOpen', true);
  const [usageOpen, setUsageOpen] = usePersistentToggle('chat.telemetry.usageOpen', true);
  const [modelParametersOpen, setModelParametersOpen] = usePersistentToggle(
    'chat.telemetry.parametersOpen',
    true,
  );
  const [providerPreferencesOpen, setProviderPreferencesOpen] = usePersistentToggle(
    'chat.telemetry.providersOpen',
    true,
  );
  const [streamingOptionsOpen, setStreamingOptionsOpen] = usePersistentToggle(
    'chat.telemetry.streamingOpen',
    true,
  );
  const [streamingEnabled, setStreamingEnabled] = usePersistentToggle('chat.streamingEnabled', false);
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [modelSearchTerm, setModelSearchTerm] = useState('');
  const [parameterOverrides, setParameterOverrides] = useState<ParameterOverrides>({});
  const [providerForm, setProviderForm] = useState<ProviderFormState>(() => createDefaultProviderForm());
  const [providerDirectory, setProviderDirectory] = useState<ModelEndpointDirectory | null>(null);
  const [providerDirectoryLoading, setProviderDirectoryLoading] = useState(false);
  const [providerDirectoryError, setProviderDirectoryError] = useState<string | null>(null);
  const [providerSearchTerm, setProviderSearchTerm] = useState('');
  const [promptDetails, setPromptDetails] = useState<CollectionPromptDetails | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [liveResponse, setLiveResponse] = useState('');
  const [isStreamingResponse, setIsStreamingResponse] = useState(false);
  const [liveReasoningSegments, setLiveReasoningSegments] = useState<ReasoningTraceSegment[]>([]);
  const [persistedLiveReasoningSegments, setPersistedLiveReasoningSegments] = useState<
    ReasoningTraceSegment[]
  >([]);
  const [activeStreamEntryKey, setActiveStreamEntryKey] = useState<string | null>(null);
  const activeStreamEntryKeyRef = useRef<string | null>(null);
  const [streamEntryKeyMap, setStreamEntryKeyMap] = useState<Record<string, string>>({});
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [liveResponseAnimationKey, setLiveResponseAnimationKey] = useState(0);
  const [liveReasoningAnimationKey, setLiveReasoningAnimationKey] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const activePollingSession = useRef<string | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());
  const chatHydrationPendingRef = useRef(false);
  const reasoningCacheRef = useRef<Map<string, ReasoningTraceSegment[]>>(new Map());

  const hasLiveText = liveResponse.trim().length > 0;
  const hasLiveReasoning = liveReasoningSegments.length > 0;
  const showStreamingBubble =
    streamingEnabled && (isStreamingResponse || hasLiveText || hasLiveReasoning);
  const liveReasoningDisplaySegments = hasLiveReasoning
    ? liveReasoningSegments
    : persistedLiveReasoningSegments;
  const hasDisplayedLiveReasoning = liveReasoningDisplaySegments.length > 0;
  const shouldShowStreamingReasoningBubble =
    (showStreamingBubble || hasDisplayedLiveReasoning) && hasDisplayedLiveReasoning;

  useEffect(() => {
    console.debug('[chat] chatEntryOrder updated', { chatEntryOrder, streamEntryKeyMap });
  }, [chatEntryOrder, streamEntryKeyMap]);

  useEffect(() => {
    if (!hasLiveText) {
      return;
    }
    setLiveResponseAnimationKey((prev) => prev + 1);
  }, [hasLiveText, liveResponse]);

  useEffect(() => {
    if (liveReasoningSegments.length === 0) {
      return;
    }
    setLiveReasoningAnimationKey((prev) => prev + 1);
  }, [liveReasoningSegments]);

  const resetLiveReasoningState = useCallback(() => {
    setLiveReasoningSegments([]);
    setPersistedLiveReasoningSegments([]);
  }, []);

  const syncMessages = useCallback(
    (
      incoming: ChatMessage[],
      { hydrate = false, resetStreamKeys = false }: { hydrate?: boolean; resetStreamKeys?: boolean } = {},
    ) => {
      setMessages((previousMessages) => {
        const sortedIncoming = sortMessagesChronologically(incoming);
        return hydrate
          ? sortedIncoming
          : mergeMessageHistory(previousMessages, sortedIncoming);
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

  const deriveToolTraces = useCallback((items: ChatMessage[]) => deriveToolTracesFromMessages(items), []);

  const authToken = token ?? '';
  const headerDescription =
    collection ? collection.description?.trim() || 'No description provided yet.' : '';

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
    if (!authToken || !collectionId) {
      setLoading(false);
      setStatus(collectionId ? 'Sign in to access this collection.' : 'Missing collection id.');
      return;
    }
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setStatus(null);
      try {
        const allCollections = await fetchCollections(authToken);
        if (cancelled) return;
        const active = allCollections.find((col) => col.id === collectionId);
        if (!active) {
          setStatus('Collection not found.');
          setCollection(null);
          return;
        }
        setCollection(active);
        setContextWindow(active.context_window);
        const [documents, sessionList] = await Promise.all([
          fetchDocuments(active.id, authToken).catch(() => []),
          listChatSessions(active.id, authToken).catch(() => []),
        ]);
        if (cancelled) return;
        setDocumentCount(documents.length);
        const sorted = sortSessions(sessionList);
        setSessions(sorted);
        setSelectedSessionId(sorted[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Unable to load chat studio.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [authToken, collectionId, sortSessions]);

  useEffect(() => {
    if (!authToken || !collectionId) {
      setPromptDetails(null);
      setPromptDraft('');
      return;
    }
    let cancelled = false;
    async function loadPrompt() {
      setPromptLoading(true);
      setPromptError(null);
      try {
        const details = await getCollectionPrompt(collectionId, authToken);
        if (cancelled) return;
        setPromptDetails(details);
        if (!promptEditorOpen) {
          setPromptDraft(details.template ?? '');
        }
      } catch (error) {
        if (!cancelled) {
          setPromptError(error instanceof Error ? error.message : 'Unable to load system prompt.');
        }
      } finally {
        if (!cancelled) {
          setPromptLoading(false);
        }
      }
    }
    loadPrompt();
    return () => {
      cancelled = true;
    };
  }, [authToken, collectionId, promptEditorOpen]);

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      setModelsLoading(true);
      try {
        const items = await listModels(authToken || undefined);
        if (!cancelled) {
          setModelCatalog(items);
          setModelsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setModelsError(error instanceof Error ? error.message : 'Unable to load model metadata.');
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
  }, [authToken]);

  useEffect(() => {
    if (!collection) {
      setActiveModelId(null);
      return;
    }
    setActiveModelId((current) => current ?? collection.chat_model);
  }, [collection]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (session?.chat_model) {
      setActiveModelId((current) => (current === session.chat_model ? current : session.chat_model));
    }
  }, [selectedSessionId, sessions]);

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
      setChatEntryOrder([]);
      chatHydrationPendingRef.current = true;
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      try {
        const history = await getChatHistory(selectedSessionId, authToken);
        if (!cancelled) {
          syncMessages(history, { hydrate: true, resetStreamKeys: true });
          setToolTraces(deriveToolTraces(history));
          setUsage(calculateSessionUsage(history));
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Unable to load chat history.');
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
        const duplicate = messages.some(
          (message) =>
            message.session_id === optimistic.session_id &&
            message.role === 'user' &&
            message.content.trim() === trimmedOptimistic &&
            message.id !== optimistic.id,
        );
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

  useEffect(() => {
    setParameterOverrides({});
  }, [activeModelId]);

  const currentModelInfo = useMemo(() => {
    const lookupId = activeModelId || collection?.chat_model;
    if (!lookupId) return null;
    return (
      modelCatalog.find((model) => model.id === lookupId || model.canonical_slug === lookupId) ??
      null
    );
  }, [activeModelId, collection?.chat_model, modelCatalog]);

  const providerModelSlug = useMemo(() => {
    const slugSource =
      currentModelInfo?.canonical_slug ?? currentModelInfo?.id ?? collection?.chat_model ?? null;
    return sanitizeModelSlug(slugSource);
  }, [collection?.chat_model, currentModelInfo?.canonical_slug, currentModelInfo?.id]);

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
      payload.sort = providerForm.sort;
    }
    if (!providerForm.allowFallbacks) {
      payload.allow_fallbacks = false;
    }
    if (providerForm.requireParameters) {
      payload.require_parameters = true;
    }
    if (providerForm.dataCollection === 'deny') {
      payload.data_collection = 'deny';
    }
    if (providerForm.zdr) {
      payload.zdr = true;
    }
    if (providerForm.enforceDistillableText) {
      payload.enforce_distillable_text = true;
    }
    const maxPrice: ProviderPreferences['max_price'] = {};
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

  useEffect(() => {
    if (!providerModelSlug) {
      setProviderDirectory(null);
      setProviderDirectoryError(null);
      setProviderDirectoryLoading(false);
      return;
    }
    const [author, ...rest] = providerModelSlug.split('/');
    const slugPart = rest.join('/');
    if (!author || !slugPart) {
      setProviderDirectory(null);
      return;
    }
    let cancelled = false;
    setProviderDirectoryLoading(true);
    setProviderDirectoryError(null);
    listModelEndpoints(author, slugPart)
      .then((response) => {
        if (cancelled) return;
        setProviderDirectory(response.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Unable to load provider catalog.';
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
  }, [providerModelSlug]);

  useEffect(() => {
    setProviderSearchTerm('');
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
    (behavior: ScrollBehavior = 'smooth') => {
      if (!endRef.current) {
        return;
      }
      if (scrollAnimationFrameRef.current) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
      markProgrammaticScroll(behavior === 'smooth' ? 600 : 150);
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
    scrollToBottom('smooth');
    const timeout = setTimeout(() => {
      scrollToBottom('smooth');
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
    setChatEntryOrder([]);
    chatHydrationPendingRef.current = true;
  }, [selectedSessionId]);

  const handleReasoningToggle = useCallback(() => {}, []);

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

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    if (programmaticScrollRef.current) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
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
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  const showFollowButton =
    !autoScrollEnabled &&
    (chatEntryOrder.length > 0 || hasLiveText || hasDisplayedLiveReasoning);

  useEffect(() => {
    console.debug('[chat] stream visibility', {
      showStreamingBubble,
      activeStreamEntryKey,
      hasLiveText,
      liveResponseLength: liveResponse.length,
      isStreamingResponse,
    });
  }, [activeStreamEntryKey, hasLiveText, isStreamingResponse, liveResponse.length, showStreamingBubble]);

  useLayoutEffect(() => {
    const textarea = chatPromptRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const fullHeight = textarea.scrollHeight;
    const clampedHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT,
      Math.min(fullHeight, CHAT_INPUT_MAX_HEIGHT),
    );
    textarea.style.height = `${clampedHeight}px`;
    textarea.style.overflowY = fullHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  const pollSessionHistory = useCallback(
    async (sessionId: string) => {
      if (!authToken) return;
      try {
        const history = await getChatHistory(sessionId, authToken);
        if (activePollingSession.current !== sessionId) {
          return;
        }
        // Hydrate instead of queueing pending reveals so previously streamed bubbles
        // stay mounted while their persisted counterparts arrive.
        syncMessages(history, { hydrate: true });
        setToolTraces(deriveToolTraces(history));
        setUsage(calculateSessionUsage(history));
        console.debug('[chat] polled session history', {
          sessionId,
          messageCount: history.length,
          hasUsage: Boolean(history.at(-1)?.usage),
        });
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
      return !messages.some(
        (message) =>
          message.session_id === optimistic.session_id &&
          message.role === 'user' &&
          message.content.trim() === trimmedOptimistic,
      );
    });
    const combined = sortMessagesChronologically([...messages, ...dedupedOptimistic]);

    return combined.flatMap((message) => {
      const entryList: ChatEntry[] = [];
      const createdAt = message.created_at || new Date().toISOString();
      const trimmedContent = message.content?.trim() ?? '';
      const isAssistant = message.role === 'assistant';
      const isUser = message.role === 'user';
      const isSystem = message.role === 'system';
      const isTool = message.role === 'tool';
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
            type: 'reasoning',
            messageId: message.id,
            source: 'assistant',
            title: 'Reasoning',
            subtitle: 'Assistant reasoning',
            segments: assistantSegments,
            createdAt,
          });
        }
      }

      if (isTool) {
        const trace = message.tool_call_id ? toolTraceMap.get(message.tool_call_id) : null;
        const toolSegments = getPersistedReasoningSegments(
          `${message.id}-tool-reasoning`,
          trace ? normalizeReasoningSegments(trace.reasoning) : normalizeReasoningSegments(message.reasoning_trace),
        );
        const toolLabel = formatToolLabel(trace?.name || message.tool_name || 'Tool');
        if (toolSegments.length > 0) {
          entryList.push({
            id: `${message.id}:reasoning:tool`,
            type: 'reasoning',
            messageId: message.id,
            source: 'tool',
            title: 'Reasoning',
            subtitle: toolLabel,
            segments: toolSegments,
            relatedToolLabel: toolLabel,
            createdAt,
          });
        }
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
        const argsRecord = coerceRecord(payloadRecord.arguments ?? {});
        const responseRecord = coerceRecord(payloadRecord.response ?? payloadRecord);
        entryList.push({
          id: `${message.id}:tool`,
          type: 'tool-call',
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
          type: isAssistant ? 'assistant' : isUser ? 'user' : 'system',
          message,
          messageId: message.id,
          content: trimmedContent || 'No response captured.',
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
      console.debug('[chat] normalized entries', { normalizedChatEntryIds });
      return normalizedChatEntryIds;
    });
    chatHydrationPendingRef.current = false;
  }, [normalizedChatEntryIds]);

  const toolReadyModels = useMemo(
    () =>
      modelCatalog.filter((model) =>
        (model.supported_parameters || []).some((param) => param.toLowerCase() === 'tools'),
      ),
    [modelCatalog],
  );

  const filteredModelCatalog = useMemo(() => {
    const query = modelSearchTerm.trim().toLowerCase();
    if (!query) return toolReadyModels;
    return toolReadyModels.filter((model) => {
      const haystack = [model.name, model.id, model.canonical_slug, model.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [modelSearchTerm, toolReadyModels]);

  const selectedModelKey = useMemo(
    () => activeModelId || collection?.chat_model || '',
    [activeModelId, collection?.chat_model],
  );

  const substitutePromptVariables = useCallback(
    (templateValue: string) => {
      if (!templateValue) return '';
      if (!promptDetails) return templateValue;
      return templateValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey) => {
        const key = String(rawKey).trim();
        return promptDetails.context?.[key] ?? `{{${key}}}`;
      });
    },
    [promptDetails],
  );

  const promptPreviewMarkdown = useMemo(() => {
    if (promptDraft) {
      return substitutePromptVariables(promptDraft);
    }
    if (promptDetails?.template) {
      return substitutePromptVariables(promptDetails.template);
    }
    return promptDetails?.rendered ?? '';
  }, [promptDraft, promptDetails, substitutePromptVariables]);

  const promptHasChanges = useMemo(() => {
    if (!promptDetails) {
      return Boolean(promptDraft);
    }
    const original = promptDetails.template ?? '';
    return promptDraft !== original;
  }, [promptDetails, promptDraft]);


  const applyChatResponse = useCallback((response: ChatCompletionPayload) => {
    console.debug('[chat] applyChatResponse start', {
      activeStreamEntryKey: activeStreamEntryKeyRef.current,
      responseMessages: response.messages.length,
    });
    setLiveResponse('');
    setIsStreamingResponse(false);
    resetLiveReasoningState();
    const finalAssistant = [...response.messages].reverse().find((msg) => msg.role === 'assistant');
    const streamKey = activeStreamEntryKeyRef.current;
    if (finalAssistant?.id && streamKey) {
      setStreamEntryKeyMap((prev) => ({ ...prev, [finalAssistant.id]: streamKey }));
      console.debug('[chat] mapped stream key to message', {
        messageId: finalAssistant.id,
        key: streamKey,
      });
    }
    setActiveStreamEntryKey(null);
    activeStreamEntryKeyRef.current = null;
    pendingSessionIdsRef.current.delete(response.session.id);
    const enrichedMessages = attachUsageToLastAssistantMessage(
      response.messages,
      response.usage ?? null,
    );
    // Always hydrate when streaming to prevent delayed message reveals
    syncMessages(enrichedMessages, { hydrate: true });
    console.debug('[chat] applied chat response', {
      messages: response.messages.length,
      toolTraces: response.tool_traces?.length ?? 0,
      usage: response.usage,
      streamEntryKeyMap,
    });
    const nextToolTraces =
      response.tool_traces && response.tool_traces.length > 0
        ? response.tool_traces
        : deriveToolTraces(response.messages);
    setToolTraces(nextToolTraces);
    setUsage(calculateSessionUsage(enrichedMessages) ?? response.usage ?? null);
    setContextConsumed(response.context_consumed);
    setContextWindow(response.context_window || collection?.context_window || 0);
    setSelectedSessionId(response.session.id);
    setActiveModelId(response.session.chat_model);
    setSessions((prev) => {
      const next = [...prev];
      const idx = next.findIndex((session) => session.id === response.session.id);
      if (idx >= 0) {
        next[idx] = response.session;
      } else {
        next.push(response.session);
      }
      return sortSessions(next);
    });
  },
    [
      collection,
      deriveToolTraces,
      resetLiveReasoningState,
      setStreamEntryKeyMap,
      sortSessions,
      streamEntryKeyMap,
      syncMessages,
    ],
  );

  const isAbortError = (value: unknown): value is DOMException =>
    value instanceof DOMException && value.name === 'AbortError';

  const handleSend = async () => {
    if (!authToken || !collection) return;
    const targetModelId = activeModelId || collection.chat_model;
    if (!targetModelId) {
      setStatus('Select a chat model before sending a message.');
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    let sessionId = selectedSessionId;
    const isNewSession = !sessionId;
    if (!sessionId) {
      sessionId = generateClientSessionId();
      setSelectedSessionId(sessionId);
      const placeholderSession: ChatSession = {
        id: sessionId,
        collection_id: collection.id,
        user_id: collection.user_id,
        title: `Chat ${new Date().toLocaleTimeString()}`,
        mode: 'chat',
        chat_model: targetModelId,
        context_tokens: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSessions((prev) => sortSessions([...prev, placeholderSession]));
      pendingSessionIdsRef.current.add(sessionId);
    }
    if (!sessionId) return;

    setDraft('');
    const placeholderMessageId = generateClientMessageId();
    const placeholderMessage: ChatMessage = {
      id: placeholderMessageId,
      session_id: sessionId,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, placeholderMessage]);

    const parameterPayload = buildParameterPayload();
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = providerRuleCount > 0 ? providerPayload : undefined;
    setLiveResponse('');
    setIsStreamingResponse(false);
    resetLiveReasoningState();
    try {
      await performChatMutation(sessionId, {
        content: trimmed,
        mode: 'chat',
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
        setSelectedSessionId(null);
      }
      if (!aborted) {
        const statusMessage =
          error instanceof Error ? error.message : 'Unable to send your message.';
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

  const runEditMutation = async (messageId: string, newContent: string) => {
    if (!authToken || !collection || !selectedSessionId) return;
    const targetModelId = activeModelId || collection.chat_model;
    if (!targetModelId) {
      setStatus('Select a chat model before sending a message.');
      return;
    }
    const parameterPayload = buildParameterPayload();
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = providerRuleCount > 0 ? providerPayload : undefined;
    try {
      await performChatMutation(selectedSessionId, {
        content: newContent,
        edit_message_id: messageId,
        mode: 'chat',
        chat_model: targetModelId,
        parameters,
        provider,
        stream: streamingEnabled,
      });
      setEditingMessageId(null);
      setEditingDraft('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to edit this turn.');
    }
  };

  const handleEditSubmit = async () => {
    if (!editingMessageId) return;
    const trimmed = editingDraft.trim();
    if (!trimmed) {
      setStatus('Edited message cannot be empty.');
      return;
    }
    await runEditMutation(editingMessageId, trimmed);
  };

  const handleRetryAssistant = async (messageId: string) => {
    await runEditMutation(messageId, '');
  };

  const handleStartNewChat = () => {
    stopProgressPolling();
    setSelectedSessionId(null);
    pendingSessionIdsRef.current.clear();
    setMessages([]);
    setToolTraces([]);
    setChatEntryOrder([]);
    chatHydrationPendingRef.current = true;
    setUsage(null);
    setContextConsumed(0);
    setDraft('');
    setLiveResponse('');
    setIsStreamingResponse(false);
    setActiveStreamEntryKey(null);
    activeStreamEntryKeyRef.current = null;
    setStreamEntryKeyMap({});
    resetLiveReasoningState();
    setEditingMessageId(null);
    setEditingDraft('');
    setOptimisticMessages([]);
  };

  const handleExportChatHistory = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const sortedMessages = sortMessagesChronologically(messages);
    const payload = { messages: sortedMessages };
    const titleSegment = sanitizeFileName(
      sessions.find((session) => session.id === selectedSessionId)?.title ?? null,
    );
    const idSegment = sanitizeFileName(selectedSessionId ?? null);
    const fallbackSegment =
      titleSegment || idSegment || sanitizeFileName(new Date().toISOString());
    const fileName = `chat-history-${fallbackSegment || Date.now().toString(36)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [messages, selectedSessionId, sessions]);

  const handlePromptEditorOpen = useCallback(() => {
    if (promptDetails) {
      setPromptDraft(promptDetails.template ?? '');
    }
    setPromptEditorOpen(true);
    window.setTimeout(() => {
      promptEditorRef.current?.focus();
    }, 20);
  }, [promptDetails]);

  const handlePromptEditorClose = useCallback(() => {
    setPromptEditorOpen(false);
  }, []);

  const handleInsertPromptVariable = useCallback((variableName: string) => {
    const insertion = `{{${variableName}}}`;
    setPromptDraft((prev) => {
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
      const spacer = prev.endsWith(' ') || prev.endsWith('\n') || prev.length === 0 ? '' : ' ';
      return `${prev}${spacer}${insertion}`;
    });
  }, []);

  const handlePromptReset = useCallback(() => {
    setPromptDraft('');
    window.requestAnimationFrame(() => {
      promptEditorRef.current?.focus();
    });
  }, []);

  const handlePromptSave = useCallback(async () => {
    if (!authToken || !collectionId) {
      setPromptError('Sign in to update the system prompt.');
      return;
    }
    setPromptSaving(true);
    setPromptError(null);
    try {
      const updated = await updateCollectionPrompt(collectionId, promptDraft, authToken);
      setPromptDetails(updated);
      setPromptDraft(updated.template ?? '');
      setPromptEditorOpen(false);
    } catch (error) {
      setPromptError(
        error instanceof Error ? error.message : 'Unable to update the system prompt right now.',
      );
    } finally {
      setPromptSaving(false);
    }
  }, [authToken, collectionId, promptDraft]);

  const handleDeleteSession = async (sessionId: string) => {
    if (!authToken) return;
    setStatus(null);
    setDeletingSessionId(sessionId);
    try {
      await deleteChatSession(sessionId, authToken);
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
          setSelectedSessionId(nextSelectedId);
        } else {
          handleStartNewChat();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete chat session.');
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
        } else if (typeof value === 'string' && value.trim() === '') {
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
      if (rawValue === '') {
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
        return rawValue.join(', ');
      }
      if (typeof rawValue === 'object') {
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

  const buildParameterPayload = useCallback(() => {
    if (!currentModelInfo) {
      return {};
    }
    const supportedSet = new Set(
      (currentModelInfo.supported_parameters || []).map((param) => param.toLowerCase()),
    );
    const payload: Record<string, unknown> = {};
    Object.entries(parameterOverrides).forEach(([key, rawValue]) => {
      const normalizedKey = key.toLowerCase();
      if (!supportedSet.has(normalizedKey)) {
        return;
      }
      if (rawValue === undefined || rawValue === null) {
        return;
      }
      if (normalizedKey === 'reasoning') {
        if (typeof rawValue === 'string') {
          const trimmedReasoning = rawValue.trim().toLowerCase();
          if (!trimmedReasoning) {
            return;
          }
          payload[normalizedKey] = { effort: trimmedReasoning };
          return;
        }
        if (typeof rawValue === 'object') {
          payload[normalizedKey] = rawValue;
        }
        return;
      }
      if (typeof rawValue === 'string') {
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
  }, [currentModelInfo, parameterOverrides]);

  const performChatMutation = useCallback(
    async (sessionId: string, payload: Omit<ChatRequestPayload, 'session_id'>) => {
      if (!authToken || !collection) {
        throw new Error('Missing authentication context.');
      }
      console.debug('[chat] performChatMutation start', {
        stream: payload.stream,
        sessionId,
        hasAbortController: Boolean(abortControllerRef.current),
      });
      const controller = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = controller;
      setIsStopping(false);
      setSending(true);
      setStatus(null);
      setLiveResponse('');
      setIsStreamingResponse(false);
      resetLiveReasoningState();
      startProgressPolling(sessionId);
      try {
        const requestPayload: ChatRequestPayload = {
          ...payload,
          session_id: sessionId,
        };
        let result: ChatCompletionPayload | null;
        if (payload.stream) {
          setIsStreamingResponse(true);
          const streamKey = `stream-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          setActiveStreamEntryKey(streamKey);
          activeStreamEntryKeyRef.current = streamKey;
          result = await streamChatWithCollection(collection.id, requestPayload, authToken, {
            signal: controller.signal,
            onToken: (token) => {
              if (token) {
                setLiveResponse((prev) => `${prev}${token}`);
              }
            },
            onReasoning: (segments) => {
              setLiveReasoningSegments(segments ?? []);
            },
            onError: (message) => {
              setStatus(message);
            },
          });
        } else {
          result = await chatWithCollection(
            collection.id,
            requestPayload,
            authToken,
            controller.signal,
          );
          setActiveStreamEntryKey(null);
          activeStreamEntryKeyRef.current = null;
        }
        if (!result) {
          throw new Error('Streaming response did not complete.');
        }
        applyChatResponse(result);
        return result;
      } catch (error) {
        setIsStreamingResponse(false);
        const shouldClearLiveState = !isAbortError(error);
        if (shouldClearLiveState) {
          setLiveResponse('');
          resetLiveReasoningState();
          setActiveStreamEntryKey(null);
          activeStreamEntryKeyRef.current = null;
        }
        throw error;
      } finally {
        stopProgressPolling();
        setSending(false);
        setIsStopping(false);
        abortControllerRef.current = null;
        console.debug('[chat] performChatMutation finished', {
          stream: payload.stream,
          succeeded: true,
        });
      }
    },
    [
      applyChatResponse,
      authToken,
      collection,
      setActiveStreamEntryKey,
      resetLiveReasoningState,
      startProgressPolling,
      stopProgressPolling,
    ],
  );

  return (
    <Fragment>
      <div className="flex h-full flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Chat studio</p>
              <h1 className="text-3xl font-semibold text-white min-w-0 truncate">
                {collection ? collection.name : 'Loading collection…'}
              </h1>
            </div>
            {collection && headerDescription && (
              <p
                className="text-sm text-slate-400 break-words"
                style={{ maxWidth: 'clamp(18rem, 50vw, 40rem)' }}
              >
                {headerDescription}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            className="flex-shrink-0 items-center gap-2 whitespace-nowrap"
            onClick={() => router.push('/chat')}
          >
            <ArrowLeft className="h-4 w-4" />
            Collections
          </Button>
        </div>

        {status && (
          <GlassCard className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            {status}
          </GlassCard>
        )}

        <div className="flex flex-1 flex-col min-h-0">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <GlassCard className="flex items-center justify-center rounded-[2rem] p-10">
                <Loader className="h-6 w-6" />
              </GlassCard>
            </div>
          ) : !collection ? (
            <div className="flex flex-1 items-center justify-center">
              <GlassCard className="rounded-[2rem] p-10 text-center text-sm text-slate-300">
                Unable to load this collection.
              </GlassCard>
            </div>
          ) : (
            <div className="glass-panel relative flex flex-1 min-h-0 overflow-hidden rounded-[2.5rem] border border-white/5 bg-slate-950/80">
              {historyOpen && (
                <aside className="hidden h-full w-72 flex-shrink-0 border-r border-white/5 bg-black/40 lg:block">
                  <HistoryPanel
                    sessions={sessions}
                    selectedSessionId={selectedSessionId}
                    onSelect={(sessionId) => setSelectedSessionId(sessionId)}
                    onNewChat={handleStartNewChat}
                    onDelete={handleDeleteSession}
                    deletingSessionId={deletingSessionId}
                    onClose={() => setHistoryOpen(false)}
                  />
                </aside>
              )}
              {!historyOpen && (
                <button
                  type="button"
                  className="absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 transition-all hover:border-white/40 hover:bg-black/60 lg:flex"
                  onClick={() => setHistoryOpen(true)}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              )}

              <div className="relative flex min-w-0 flex-1 flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Conversation</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-semibold text-white">{collection.name}</h2>
                      <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        {documentCount} documents
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!historyOpen && (
                      <Button
                        variant="secondary"
                        className="flex h-10 items-center justify-center gap-2"
                        onClick={handleStartNewChat}
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>New chat</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex h-full flex-col min-h-0 overflow-hidden">
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleScroll}
                    className="relative flex-1 min-h-0 overflow-y-auto px-16 py-6 scroll-smooth !overflow-anchor-none"
                    style={{ overflowAnchor: 'none' }}
                  >
                    <div className="flex h-full flex-col gap-4">
                      <ChatTimeline
                        collectionName={collection ? collection.name : null}
                        chatEntryOrder={chatEntryOrder}
                        chatEntryMap={chatEntryMap}
                        streamEntryKeyMap={streamEntryKeyMap}
                        selectedSessionId={selectedSessionId}
                        sending={sending}
                        editingMessageId={editingMessageId}
                        editingDraft={editingDraft}
                        onEditChange={setEditingDraft}
                        onEditStart={(messageId, content) => {
                          setEditingMessageId(messageId);
                          setEditingDraft(content);
                        }}
                        onEditCancel={() => {
                          setEditingMessageId(null);
                          setEditingDraft('');
                        }}
                        onEditSubmit={handleEditSubmit}
                        onRetryAssistant={handleRetryAssistant}
                        onReasoningToggle={handleReasoningToggle}
                        markdownComponents={markdownComponents}
                        samplePrompts={samplePrompts}
                        onSamplePromptSelect={setDraft}
                        liveResponse={liveResponse}
                        hasLiveText={hasLiveText}
                        liveResponseAnimationKey={liveResponseAnimationKey}
                        activeStreamEntryKey={activeStreamEntryKey}
                        shouldShowStreamingReasoningBubble={shouldShowStreamingReasoningBubble}
                        liveReasoningAnimationKey={liveReasoningAnimationKey}
                        liveReasoningDisplaySegments={liveReasoningDisplaySegments}
                        showStreamingBubble={showStreamingBubble}
                      />
                      <div ref={endRef} />
                    </div>
                  </div>
                  {showFollowButton && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-[9rem] flex justify-center">
                      <button
                        type="button"
                        onClick={handleReenableAutoScroll}
                        aria-label="Scroll to latest message"
                        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white opacity-90 shadow-2xl backdrop-blur-sm transition hover:bg-black/80 hover:opacity-100"
                      >
                        <ArrowDown className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                  <ChatInput
                    draft={draft}
                    setDraft={setDraft}
                    sending={sending}
                    isStopping={isStopping}
                    onSend={handleSend}
                    onStop={handleStopGeneration}
                    inputRef={chatPromptRef}
                  />

                </div>
              </div>

              {telemetryOpen && (
                <aside className="hidden h-full w-[26rem] flex-shrink-0 border-l border-white/5 bg-black/40 p-6 lg:block">
                  <TelemetryPanel
                    onClose={() => setTelemetryOpen(false)}
                    promptDetails={promptDetails}
                    promptLoading={promptLoading}
                    promptError={promptError}
                    systemPromptOpen={systemPromptOpen}
                    onSystemPromptToggle={() => setSystemPromptOpen((prev) => !prev)}
                    onPromptEdit={handlePromptEditorOpen}
                    streamingOptionsOpen={streamingOptionsOpen}
                    onStreamingOptionsToggle={() => setStreamingOptionsOpen((prev) => !prev)}
                    streamingEnabled={streamingEnabled}
                    onStreamingToggle={setStreamingEnabled}
                    modelSelectorOpen={modelSelectorOpen}
                    onModelSelectorToggle={() => setModelSelectorOpen((prev) => !prev)}
                    modelSearchTerm={modelSearchTerm}
                    onModelSearchChange={setModelSearchTerm}
                    toolReadyModels={toolReadyModels}
                    filteredModelCatalog={filteredModelCatalog}
                    modelsLoading={modelsLoading}
                    modelsError={modelsError}
                    selectedModelKey={selectedModelKey}
                    onSelectModel={setActiveModelId}
                    currentModelInfo={currentModelInfo}
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
                    collection={collection}
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
                </aside>
              )}
              {!telemetryOpen && (
                <button
                  type="button"
                  className="absolute right-4 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 hover:border-white/40 lg:flex"
                  onClick={() => setTelemetryOpen(true)}
                >
                  <PanelRightOpen className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <PromptEditorOverlay
        isOpen={promptEditorOpen}
        onClose={handlePromptEditorClose}
        promptDetails={promptDetails}
        promptDraft={promptDraft}
        setPromptDraft={setPromptDraft}
        promptSaving={promptSaving}
        promptError={promptError}
        promptHasChanges={promptHasChanges}
        promptPreviewMarkdown={promptPreviewMarkdown}
        onSave={handlePromptSave}
        onReset={handlePromptReset}
        onInsertVariable={handleInsertPromptVariable}
        inputRef={promptEditorRef}
        markdownComponents={markdownComponents}
      />

    </Fragment>
  );
}
