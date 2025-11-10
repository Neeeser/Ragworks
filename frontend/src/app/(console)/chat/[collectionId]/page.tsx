'use client';

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PlusCircle,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { Components } from 'react-markdown';

import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/panel';
import { Loader } from '@/components/ui/loader';
import { CollapsibleReasoning } from '@/components/ui/collapsible-reasoning';
import {
  chatWithCollection,
  deleteChatSession,
  fetchCollections,
  fetchDocuments,
  getChatHistory,
  listChatSessions,
  listModelEndpoints,
  listModels,
} from '@/lib/api';
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
  ModelEndpointDirectory,
  ModelInfo,
  ProviderEndpoint,
  ProviderPreferences,
  ProviderSortOption,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const samplePrompts = [
  'Give me the latest ingestion summary with citations.',
  'What changed in the newest document batch?',
  'Draft next steps using the last three answers.',
  'List any flagged chunks that might need review.',
];

type ParameterInputKind = 'number' | 'integer' | 'boolean' | 'list' | 'json' | 'select';

interface ParameterOption {
  label: string;
  value: string;
}

interface ParameterDefinitionShape {
  key: string;
  label: string;
  description: string;
  input: ParameterInputKind;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  options?: ParameterOption[];
  rows?: number;
}

const PARAMETER_DEFINITIONS = [
  {
    key: 'temperature',
    label: 'Temperature',
    description: 'Higher values increase randomness (0-2).',
    input: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    placeholder: '1.0',
  },
  {
    key: 'top_p',
    label: 'Top P',
    description: 'Limit tokens to a probability mass.',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: '1.0',
  },
  {
    key: 'top_k',
    label: 'Top K',
    description: 'Sample only from the top K tokens.',
    input: 'integer',
    min: 0,
    step: 1,
    placeholder: '0 (disabled)',
  },
  {
    key: 'min_p',
    label: 'Min P',
    description: 'Minimum relative probability threshold.',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: '0.0',
  },
  {
    key: 'top_a',
    label: 'Top A',
    description: 'Adaptive nucleus setting (0-1).',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: '0.0',
  },
  {
    key: 'frequency_penalty',
    label: 'Frequency penalty',
    description: 'Penalize repeated tokens by count.',
    input: 'number',
    min: -2,
    max: 2,
    step: 0.1,
    placeholder: '0.0',
  },
  {
    key: 'presence_penalty',
    label: 'Presence penalty',
    description: 'Discourage reusing prior tokens.',
    input: 'number',
    min: -2,
    max: 2,
    step: 0.1,
    placeholder: '0.0',
  },
  {
    key: 'repetition_penalty',
    label: 'Repetition penalty',
    description: 'Reduce repeated generations.',
    input: 'number',
    min: 0,
    max: 2,
    step: 0.05,
    placeholder: '1.0',
  },
  {
    key: 'max_tokens',
    label: 'Max tokens',
    description: 'Cap on generated tokens.',
    input: 'integer',
    min: 1,
    step: 1,
    placeholder: '512',
  },
  {
    key: 'reasoning',
    label: 'Reasoning effort',
    description: 'Control how much thinking budget the model should spend when reasoning tokens are available.',
    input: 'select',
    options: [
      { label: 'Model default', value: '' },
      { label: 'Minimal', value: 'minimal' },
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
  },
  {
    key: 'seed',
    label: 'Seed',
    description: 'Deterministic sampling seed.',
    input: 'integer',
    min: 0,
    step: 1,
    placeholder: 'Leave blank for randomness',
  },
  {
    key: 'logprobs',
    label: 'Log probabilities',
    description: 'Return logprobs for each token.',
    input: 'boolean',
  },
  {
    key: 'top_logprobs',
    label: 'Top logprobs',
    description: 'How many alternate tokens to include (0-20).',
    input: 'integer',
    min: 0,
    max: 20,
    step: 1,
    placeholder: '5',
  },
  {
    key: 'structured_outputs',
    label: 'Structured outputs',
    description: 'Request JSON schema enforcement.',
    input: 'boolean',
  },
  {
    key: 'verbosity',
    label: 'Verbosity',
    description: 'Control response detail level.',
    input: 'select',
    options: [
      { label: 'Model default', value: '' },
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
  },
  {
    key: 'stop',
    label: 'Stop sequences',
    description: 'Comma or newline separated stop strings.',
    input: 'list',
    placeholder: '###, END',
    rows: 2,
  },
  {
    key: 'response_format',
    label: 'Response format',
    description: 'JSON describing the expected response schema.',
    input: 'json',
    placeholder: '{ "type": "json_object" }',
    rows: 3,
  },
  {
    key: 'logit_bias',
    label: 'Logit bias',
    description: 'JSON map of token IDs to bias values.',
    input: 'json',
    placeholder: '{ "318": -100 }',
    rows: 3,
  },
] as const satisfies readonly ParameterDefinitionShape[];

type ParameterDefinition = (typeof PARAMETER_DEFINITIONS)[number];
type ModelParameterKey = ParameterDefinition['key'];
type ParameterValue = number | string | boolean | Record<string, unknown>;
type ParameterOverrides = Partial<Record<ModelParameterKey, ParameterValue>>;

type ProviderSortChoice = '' | ProviderSortOption;

interface ProviderFormState {
  sort: ProviderSortChoice;
  order: string[];
  only: string[];
  ignore: string[];
  quantizations: string[];
  allowFallbacks: boolean;
  requireParameters: boolean;
  dataCollection: 'allow' | 'deny';
  zdr: boolean;
  enforceDistillableText: boolean;
  maxPrompt: string;
  maxCompletion: string;
  maxRequest: string;
  maxImage: string;
}

type ProviderSelectionField = 'order' | 'only' | 'ignore';

const PARAMETER_DEFINITION_MAP: Record<ModelParameterKey, ParameterDefinition> =
  PARAMETER_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.key] = definition;
      return acc;
    },
    {} as Record<ModelParameterKey, ParameterDefinition>,
  );

const safeParseJSON = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

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

const normalizeReasoningSegments = (payload: unknown): ReasoningTraceSegment[] => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.filter(Boolean) as ReasoningTraceSegment[];
  }
  if (typeof payload === 'object') {
    const candidate = payload as { segments?: ReasoningTraceSegment[] };
    if (Array.isArray(candidate?.segments)) {
      return candidate.segments.filter(Boolean) as ReasoningTraceSegment[];
    }
    return [candidate as ReasoningTraceSegment];
  }
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed ? [{ type: 'text', content: trimmed }] : [];
  }
  return [{ type: 'value', content: String(payload) }];
};

const coerceRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (value === null || value === undefined) {
    return {};
  }
  return { value };
};

const QUANTIZATION_OPTIONS = [
  'int4',
  'int8',
  'fp4',
  'fp6',
  'fp8',
  'fp16',
  'bf16',
  'fp32',
  'unknown',
] as const;

const ENDPOINT_STATUS_LABELS: Record<string, string> = {
  '0': 'Operational',
  '-1': 'Degraded',
  '-2': 'Unhealthy',
  '-3': 'Outage',
  '-5': 'Offline',
  '-10': 'Disabled',
};

const formatProviderPrice = (value?: number | string | null): string => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '—';
    }
    const formatted = value >= 1 ? value.toFixed(2) : value.toPrecision(2);
    return `$${formatted}`;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '—';
  }
  if (/^[0-9.]+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const formatted = numeric >= 1 ? numeric.toFixed(2) : numeric.toPrecision(2);
      return `$${formatted}`;
    }
  }
  return trimmed;
};

const formatUptimePercentage = (value?: number | null): string => {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
};

const getEndpointStatusLabel = (status?: string | number | null): string => {
  if (!status) {
    return 'Unknown';
  }
  const key = typeof status === 'number' ? String(status) : status;
  return ENDPOINT_STATUS_LABELS[key] ?? 'Unknown';
};

const sanitizeModelSlug = (candidate?: string | null): string | null => {
  if (!candidate) {
    return null;
  }
  const baseSlug = candidate.split(':')[0]?.trim() ?? '';
  if (!baseSlug || !baseSlug.includes('/')) {
    return null;
  }
  return baseSlug;
};

const parsePriceInput = (value: string): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const createDefaultProviderForm = (): ProviderFormState => ({
  sort: '',
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: true,
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

interface TelemetrySectionProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

const TelemetrySection = ({
  title,
  description,
  icon,
  isOpen,
  onToggle,
  children,
}: TelemetrySectionProps) => (
  <div className="rounded-2xl border border-white/10 bg-white/5">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/10"
    >
      <div className="flex flex-1 items-center gap-2">
        {icon && <span className="text-slate-300">{icon}</span>}
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{title}</p>
          {description && (
            <p className="text-[11px] text-slate-300">{description}</p>
          )}
        </div>
      </div>
      {isOpen ? (
        <ChevronDown className="h-4 w-4 text-slate-300" />
      ) : (
        <ChevronRight className="h-4 w-4 text-slate-300" />
      )}
    </button>
    {isOpen && <div className="space-y-3 px-4 pb-4 pt-3">{children}</div>}
  </div>
);

const usageMetrics: { key: keyof UsageBreakdown; label: string }[] = [
  { key: 'prompt_tokens', label: 'Prompt tokens' },
  { key: 'completion_tokens', label: 'Completion tokens' },
  { key: 'total_tokens', label: 'Total tokens' },
  { key: 'reasoning_tokens', label: 'Reasoning tokens' },
];

const getLatestAssistantUsage = (items: ChatMessage[]): UsageBreakdown | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const message = items[index];
    if (message.role === 'assistant' && message.usage) {
      return message.usage;
    }
  }
  return null;
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
const STREAM_REVEAL_DELAY = 350;
const PROGRESS_POLL_INTERVAL = 800;

const markdownComponents: Components = {
  p: ({ children }) => (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{children}</div>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-cyan-300 underline decoration-dotted underline-offset-4"
    >
      {children}
    </a>
  ),
  code: ({ inline, className, children }) =>
    inline ? (
      <code className={cn('rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-cyan-200', className)}>
        {children}
      </code>
    ) : (
      <pre className="mt-3 overflow-auto rounded-2xl bg-slate-900/70 p-3 text-xs text-slate-100">
        <code className={className}>{children}</code>
      </pre>
    ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
  li: ({ children }) => <li className="text-slate-100">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-violet-400/60 pl-3 text-sm italic text-slate-200">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
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
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([]);
  const [pendingMessageIds, setPendingMessageIds] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(0);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = usePersistentToggle('chat.historyOpen', true);
  const [telemetryOpen, setTelemetryOpen] = usePersistentToggle('chat.telemetryOpen', true);
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
  const endRef = useRef<HTMLDivElement | null>(null);
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const activePollingSession = useRef<string | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());

  const syncMessages = useCallback(
    (incoming: ChatMessage[], options: { hydrate?: boolean } = {}) => {
      const { hydrate = false } = options;
      setMessages(incoming);
      setVisibleMessageIds((prev) => {
        const nextIds = incoming.map((message) => message.id);
        if (hydrate || prev.length === 0) {
          setPendingMessageIds([]);
          return nextIds;
        }
        const nextIdSet = new Set(nextIds);
        const hasRemoval = prev.some((id) => !nextIdSet.has(id));
        if (hasRemoval) {
          setPendingMessageIds([]);
          return nextIds;
        }
        const prevSet = new Set(prev);
        const newIds = nextIds.filter((id) => !prevSet.has(id));
        if (newIds.length > 0) {
          setPendingMessageIds((queue) => [...queue, ...newIds]);
        }
        return prev;
      });
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
      setVisibleMessageIds([]);
      setPendingMessageIds([]);
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    if (pendingSessionIdsRef.current.has(selectedSessionId)) {
      setMessages([]);
      setToolTraces([]);
      setVisibleMessageIds([]);
      setPendingMessageIds([]);
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      try {
        const history = await getChatHistory(selectedSessionId, authToken);
        if (!cancelled) {
          syncMessages(history, { hydrate: true });
          setToolTraces(deriveToolTraces(history));
          setUsage(getLatestAssistantUsage(history));
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessageIds]);

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
        syncMessages(history);
        setToolTraces(deriveToolTraces(history));
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

  useEffect(() => {
    if (pendingMessageIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nextId = pendingMessageIds[0];
      const nextMessage = messages.find((msg) => msg.id === nextId);
      if (nextMessage) {
        setVisibleMessageIds((prev) => [...prev, nextId]);
      }
      setPendingMessageIds((prev) => prev.slice(1));
    }, STREAM_REVEAL_DELAY);
    return () => window.clearTimeout(timer);
  }, [pendingMessageIds, messages]);

  const contextUtilization = useMemo(() => {
    if (!contextWindow) return 0;
    return Math.min(100, Math.round((contextConsumed / contextWindow) * 100));
  }, [contextConsumed, contextWindow]);

  const displayedMessages = useMemo(() => {
    if (visibleMessageIds.length === 0) {
      return messages;
    }
    const idSet = new Set(visibleMessageIds);
    return messages.filter((message) => idSet.has(message.id));
  }, [messages, visibleMessageIds]);

  const toolTraceMap = useMemo(() => {
    const map = new Map<string, ToolCallTrace>();
    toolTraces.forEach((trace) => map.set(trace.id, trace));
    return map;
  }, [toolTraces]);

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


  const applyChatResponse = useCallback(
    (response: ChatCompletionPayload) => {
      pendingSessionIdsRef.current.delete(response.session.id);
      syncMessages(response.messages);
      const nextToolTraces =
        response.tool_traces && response.tool_traces.length > 0
          ? response.tool_traces
          : deriveToolTraces(response.messages);
      setToolTraces(nextToolTraces);
      setUsage(response.usage);
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
    [collection, deriveToolTraces, sortSessions, syncMessages],
  );

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
    try {
      await performChatMutation(sessionId, {
        content: trimmed,
        mode: 'chat',
        title: isNewSession ? `Chat ${new Date().toLocaleTimeString()}` : undefined,
        chat_model: targetModelId,
        parameters,
        provider,
      });
    } catch (error) {
      setDraft(trimmed);
      if (isNewSession && sessionId) {
        pendingSessionIdsRef.current.delete(sessionId);
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        setSelectedSessionId(null);
      }
      setStatus(error instanceof Error ? error.message : 'Unable to send your message.');
    } finally {
      setOptimisticMessages((prev) =>
        prev.filter((message) => message.id !== placeholderMessageId),
      );
    }
  };

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
    setVisibleMessageIds([]);
    setPendingMessageIds([]);
    setUsage(null);
    setContextConsumed(0);
    setDraft('');
    setEditingMessageId(null);
    setEditingDraft('');
    setOptimisticMessages([]);
  };

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
      setSending(true);
      setStatus(null);
      startProgressPolling(sessionId);
      try {
        const result = await chatWithCollection(
          collection.id,
          {
            ...payload,
            session_id: sessionId,
          },
          authToken,
        );
        applyChatResponse(result);
        return result;
      } catch (error) {
        throw error;
      } finally {
        stopProgressPolling();
        setSending(false);
      }
    },
    [applyChatResponse, authToken, collection, startProgressPolling, stopProgressPolling],
  );

  const roleVariants: Record<string, string> = {
    user: 'border-violet-500/40 bg-violet-500/15 text-violet-50',
    assistant: 'border-white/15 bg-white/10 text-white',
    tool: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50',
    system: 'border-slate-500/30 bg-slate-900/60 text-slate-100',
  };

  const renderParameterControl = (definition: ParameterDefinition) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(parameterOverrides, definition.key);
    const currentValue = parameterOverrides[definition.key];
    const defaultDisplay = formatDefaultParameter(definition.key);
    const inputClasses =
      'w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-violet-400';

    let control: ReactNode;
    if (definition.input === 'number' || definition.input === 'integer') {
      control = (
        <input
          type="number"
          min={definition.min}
          max={definition.max}
          step={definition.step ?? (definition.input === 'integer' ? 1 : 0.05)}
          className={inputClasses}
          placeholder={definition.placeholder}
          value={typeof currentValue === 'number' ? currentValue : ''}
          onChange={(event) =>
            handleNumberParameterChange(
              definition.key,
              event.target.value,
              definition.input === 'integer',
            )
          }
        />
      );
    } else if (definition.input === 'boolean') {
      control = (
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-white/30 bg-transparent"
            checked={currentValue === true}
            onChange={(event) => handleBooleanParameterChange(definition.key, event.target.checked)}
          />
          <span>Enable</span>
        </label>
      );
    } else if (definition.input === 'select') {
      control = (
        <select
          className={inputClasses}
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChange={(event) => handleSelectParameterChange(definition.key, event.target.value)}
        >
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <textarea
          className={`${inputClasses} h-auto`}
          rows={definition.rows ?? 2}
          placeholder={definition.placeholder}
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChange={(event) => handleTextParameterChange(definition.key, event.target.value)}
        />
      );
    }

    return (
      <div
        key={definition.key}
        className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{definition.label}</p>
            <p className="text-xs text-slate-400">{definition.description}</p>
            {defaultDisplay && (
              <p className="text-[11px] text-slate-500">Default: {defaultDisplay}</p>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-slate-400 transition hover:text-white disabled:opacity-40"
            disabled={!hasOverride}
            onClick={() => handleClearParameter(definition.key)}
          >
            Clear
          </button>
        </div>
        {control}
      </div>
    );
  };

  const renderModelSelector = () => {
    const visibleModels = filteredModelCatalog.slice(0, 50);
    const formatCost = (value?: number | string | null) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'number') {
        return value.toLocaleString(undefined, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 6,
        });
      }
      const trimmed = String(value).trim();
      return trimmed || null;
    };

    return (
      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">Model routing</p>
            <p className="text-sm text-slate-300">
              {currentModelInfo?.name || selectedModelKey || 'Select a tool-enabled model'}
            </p>
            {selectedModelKey && (
              <p className="text-[11px] text-slate-500 break-all">{selectedModelKey}</p>
            )}
          </div>
          <div className="text-right text-[11px] uppercase tracking-[0.3em] text-slate-500">
            <span>{toolReadyModels.length} ready</span>
            {modelsLoading && (
              <span className="ml-2 inline-flex items-center gap-1 text-slate-300">
                <Loader className="h-3.5 w-3.5" />
                Syncing
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Only models with OpenAI-compatible tool calling are available. Pick any option to apply it
          to the current or next turn.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            className="w-full rounded-2xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
            placeholder="Search OpenRouter models…"
            value={modelSearchTerm}
            onChange={(event) => setModelSearchTerm(event.target.value)}
          />
        </div>
        {modelsError && <p className="text-sm text-rose-300">{modelsError}</p>}
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {modelsLoading && toolReadyModels.length === 0 ? (
            <p className="text-sm text-slate-400">Loading tool-compatible models…</p>
          ) : visibleModels.length === 0 ? (
            <p className="text-sm text-slate-400">
              {modelSearchTerm
                ? `No models match "${modelSearchTerm}".`
                : 'No tool-enabled models available.'}
            </p>
          ) : (
            visibleModels.map((model) => {
              const isSelected =
                (selectedModelKey && model.id === selectedModelKey) ||
                (selectedModelKey && model.canonical_slug === selectedModelKey);
              const contextLabel = model.context_length
                ? `${model.context_length.toLocaleString()} ctx`
                : null;
              const promptLabel = formatCost(model.pricing?.prompt);
              const completionLabel = formatCost(model.pricing?.completion);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setActiveModelId(model.id)}
                  className={cn(
                    'w-full rounded-2xl border px-3 py-2 text-left transition',
                    isSelected
                      ? 'border-violet-400 bg-violet-500/10 text-white'
                      : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{model.name}</p>
                      <p className="text-[11px] text-slate-500 break-all">{model.id}</p>
                    </div>
                    {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-violet-300" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                    {contextLabel && <span>{contextLabel}</span>}
                    {promptLabel && <span>Prompt {promptLabel}</span>}
                    {completionLabel && <span>Completion {completionLabel}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderParameterControls = () => {
    const selectedModelLabel = activeModelId || collection?.chat_model || 'the selected model';
    if (modelsError) {
      return <p className="text-sm text-rose-300">{modelsError}</p>;
    }
    if (modelsLoading && !currentModelInfo) {
      return <p className="text-sm text-slate-400">Loading model catalog…</p>;
    }
    if (!collection) {
      return <p className="text-sm text-slate-400">Select a collection to view model controls.</p>;
    }
    if (!currentModelInfo) {
      return (
        <p className="text-sm text-slate-400">
          Unable to find OpenRouter metadata for <span className="text-white">{selectedModelLabel}</span>.
        </p>
      );
    }
    if (visibleParameterDefinitions.length === 0) {
      return (
        <p className="text-sm text-slate-400">
          This model does not expose the common sampling parameters listed in the OpenRouter docs.
        </p>
      );
    }
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">Model</p>
          <p className="text-white">{currentModelInfo.name}</p>
          <p className="text-[11px] text-slate-500 break-all">{currentModelInfo.id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
            <span>{visibleParameterDefinitions.length} controls</span>
            {activeParameterCount > 0 && (
              <button
                type="button"
                onClick={resetAllParameters}
                className="text-slate-200 underline-offset-4 hover:underline"
              >
                Reset overrides
              </button>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {visibleParameterDefinitions.map((definition) => renderParameterControl(definition))}
        </div>
      </div>
    );
  };

  const renderProviderControls = () => {
    const inputClasses =
      'w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white outline-none focus:border-violet-400';
    const resetProviderPreferences = () => setProviderForm(createDefaultProviderForm());
    const endpoints = providerDirectory?.endpoints ?? [];
    const normalizedSearch = providerSearchTerm.trim().toLowerCase();
    const filteredEndpoints =
      normalizedSearch.length === 0
        ? endpoints
        : endpoints.filter((endpoint) => {
            const haystack = `${endpoint.name} ${endpoint.provider_name ?? ''} ${
              endpoint.tag ?? ''
            }`.toLowerCase();
            return haystack.includes(normalizedSearch);
          });
    const visibleEndpoints = [...filteredEndpoints].sort((a, b) => {
      const providerCompare = (a.provider_name || '').localeCompare(b.provider_name || '');
      if (providerCompare !== 0) {
        return providerCompare;
      }
      return a.name.localeCompare(b.name);
    });

    const toggleProviderField = (field: ProviderSelectionField, slug: string) => {
      setProviderForm((prev) => {
        const list = prev[field];
        const exists = list.includes(slug);
        const nextList = exists ? list.filter((entry) => entry !== slug) : [...list, slug];
        return { ...prev, [field]: nextList };
      });
    };

    const moveProviderOrderEntry = (slug: string, delta: number) => {
      setProviderForm((prev) => {
        const index = prev.order.indexOf(slug);
        if (index === -1) {
          return prev;
        }
        const target = index + delta;
        if (target < 0 || target >= prev.order.length) {
          return prev;
        }
        const nextOrder = [...prev.order];
        nextOrder.splice(index, 1);
        nextOrder.splice(target, 0, slug);
        return { ...prev, order: nextOrder };
      });
    };

    const renderSelectionField = (
      label: string,
      field: ProviderSelectionField,
      options?: { showIndex?: boolean; allowReorder?: boolean },
    ) => {
      const values = providerForm[field];
      return (
        <div className="space-y-2" key={field}>
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-500">
            <span>{label}</span>
            {values.length === 0 && <span className="text-[10px] text-slate-500">None selected</span>}
          </div>
          {values.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {values.map((slug, index) => (
                <div
                  key={`${field}-${slug}`}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white"
                >
                  {options?.showIndex && <span className="text-[10px] text-slate-400">#{index + 1}</span>}
                  <span className="font-mono text-[11px]">{slug}</span>
                  {options?.allowReorder && values.length > 1 && (
                    <div className="flex items-center gap-1 text-slate-400">
                      <button
                        type="button"
                        className="hover:text-white disabled:opacity-30"
                        onClick={() => moveProviderOrderEntry(slug, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${slug} earlier`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="hover:text-white disabled:opacity-30"
                        onClick={() => moveProviderOrderEntry(slug, 1)}
                        disabled={index === values.length - 1}
                        aria-label={`Move ${slug} later`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-slate-300 hover:text-white"
                    onClick={() => toggleProviderField(field, slug)}
                    aria-label={`Remove ${slug}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    const toggleQuantization = (value: string) => {
      setProviderForm((prev) => {
        const exists = prev.quantizations.includes(value);
        const next = exists
          ? prev.quantizations.filter((entry) => entry !== value)
          : [...prev.quantizations, value];
        return { ...prev, quantizations: next };
      });
    };

    const renderProviderCard = (endpoint: ProviderEndpoint, position: number) => {
      const slug = endpoint.name;
      const orderActive = providerForm.order.includes(slug);
      const onlyActive = providerForm.only.includes(slug);
      const ignoreActive = providerForm.ignore.includes(slug);
      const promptPrice = formatProviderPrice(endpoint.pricing?.prompt);
      const completionPrice = formatProviderPrice(
        endpoint.pricing?.completion ?? endpoint.pricing?.request,
      );
      const maxTokens =
        endpoint.max_completion_tokens ??
        endpoint.max_prompt_tokens ??
        endpoint.context_length ??
        null;
      const parameterCount = endpoint.supported_parameters?.length ?? 0;
      const actionClasses = (active: boolean) =>
        cn(
          'rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]',
          active
            ? 'border-violet-400 bg-violet-500/20 text-white'
            : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/40',
        );
      const cardKey = `${slug}-${endpoint.provider_name ?? 'unknown'}-${endpoint.tag ?? 'default'}-${position}`;
      return (
        <div key={cardKey} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-white">{slug}</p>
              <p className="text-xs text-slate-400">{endpoint.provider_name || 'Unknown provider'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
              <span>{getEndpointStatusLabel(endpoint.status)}</span>
              <span>Uptime {formatUptimePercentage(endpoint.uptime_last_30m)}</span>
              {endpoint.tag && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-200">
                  {endpoint.tag}
                </span>
              )}
              {endpoint.supports_implicit_caching && (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                  Cache
                </span>
              )}
            </div>
          </div>
          <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
            <div className="rounded-xl border border-white/5 bg-black/30 p-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Prompt</p>
              <p className="text-white">{promptPrice}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/30 p-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Completion</p>
              <p className="text-white">{completionPrice}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/30 p-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Capacity</p>
              <p className="text-white">
                {maxTokens ? `${Math.round(maxTokens).toLocaleString()} tokens` : '—'}
              </p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                {parameterCount} params
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={actionClasses(orderActive)}
              onClick={() => toggleProviderField('order', slug)}
            >
              {orderActive ? 'In order' : 'Add to order'}
            </button>
            <button
              type="button"
              className={actionClasses(onlyActive)}
              onClick={() => toggleProviderField('only', slug)}
            >
              {onlyActive ? 'Allowing' : 'Allow only'}
            </button>
            <button
              type="button"
              className={actionClasses(ignoreActive)}
              onClick={() => toggleProviderField('ignore', slug)}
            >
              {ignoreActive ? 'Ignored' : 'Ignore'}
            </button>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Routing strategy</p>
              <p className="text-sm text-slate-300">
                Nitro/Floor shortcuts map to these settings. Use the catalog below to build a custom
                provider order.
              </p>
            </div>
            {providerRuleCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full border border-white/10 px-3 text-xs text-slate-200"
                onClick={resetProviderPreferences}
              >
                Reset rules
              </Button>
            )}
          </div>
          <label className="space-y-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Sort providers</span>
            <select
              className={inputClasses}
              value={providerForm.sort}
              onChange={(event) =>
                setProviderForm((prev) => ({
                  ...prev,
                  sort: event.target.value as ProviderSortChoice,
                }))
              }
            >
              <option value="">Load balance (default)</option>
              <option value="throughput">Throughput (Nitro)</option>
              <option value="price">Price (Floor)</option>
              <option value="latency">Latency</option>
            </select>
          </label>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
              <span className="font-medium text-white">Allow fallbacks</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-white/30 bg-transparent"
                checked={providerForm.allowFallbacks}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, allowFallbacks: event.target.checked }))
                }
              />
            </label>
            <p className="mt-1 text-xs text-slate-400">
              Disable this to fail fast if your preferred providers are unavailable.
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Provider catalog</p>
              <p className="text-sm text-slate-300">
                {providerModelSlug
                  ? `Pulled from OpenRouter for ${providerModelSlug}.`
                  : 'Select a model to browse provider endpoints.'}
              </p>
            </div>
            {providerDirectory && (
              <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                {providerDirectory.endpoints.length} endpoints
              </span>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              className={cn(
                inputClasses,
                'pl-9 disabled:cursor-not-allowed disabled:opacity-60',
              )}
              placeholder="Search provider slug, vendor, or tag"
              value={providerSearchTerm}
              onChange={(event) => setProviderSearchTerm(event.target.value)}
              disabled={!providerModelSlug}
            />
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            {providerDirectoryLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader className="h-4 w-4" />
                <span>Loading endpoints…</span>
              </div>
            ) : providerDirectoryError ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                {providerDirectoryError}
              </div>
            ) : !providerModelSlug ? (
              <p className="text-sm text-slate-400">Pick a model to inspect its provider list.</p>
            ) : visibleEndpoints.length === 0 ? (
              <p className="text-sm text-slate-400">
                {normalizedSearch
                  ? 'No providers match your search.'
                  : 'No endpoints published for this model yet.'}
              </p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {visibleEndpoints.map((endpoint, index) => renderProviderCard(endpoint, index))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Selections & filters</p>
          {renderSelectionField('Order priority', 'order', {
            showIndex: true,
            allowReorder: true,
          })}
          {providerForm.order.length > 0 && (
            <p className="text-[11px] text-slate-500">
              Requests follow this order before falling back to the OpenRouter defaults.
            </p>
          )}
          {renderSelectionField('Allow only', 'only')}
          {renderSelectionField('Ignore', 'ignore')}
          <div className="space-y-2">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Quantizations</span>
            <div className="flex flex-wrap gap-2">
              {QUANTIZATION_OPTIONS.map((option) => {
                const active = providerForm.quantizations.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    className={cn(
                      'rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]',
                      active
                        ? 'border-cyan-400 bg-cyan-500/20 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/40',
                    )}
                    onClick={() => toggleQuantization(option)}
                  >
                    {option.toUpperCase()}
                  </button>
                );
              })}
            </div>
            {providerForm.quantizations.length === 0 ? (
              <p className="text-xs text-slate-500">
                Load balance across all quantization levels.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                {providerForm.quantizations.length} selected • filters apply to open-weight endpoints.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Data guardrails</p>
          <div className="space-y-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Require parameters</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={providerForm.requireParameters}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, requireParameters: event.target.checked }))
                  }
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Only route to providers that support every parameter in your request.
              </p>
            </div>
            <label className="space-y-2 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Data collection</span>
              <select
                className={inputClasses}
                value={providerForm.dataCollection}
                onChange={(event) =>
                  setProviderForm((prev) => ({
                    ...prev,
                    dataCollection: event.target.value === 'deny' ? 'deny' : 'allow',
                  }))
                }
              >
                <option value="allow">Allow (default)</option>
                <option value="deny">Deny (no collection)</option>
              </select>
            </label>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Zero data retention</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={providerForm.zdr}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, zdr: event.target.checked }))
                  }
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">Only send requests to ZDR endpoints.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Distillable text only</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={providerForm.enforceDistillableText}
                  onChange={(event) =>
                    setProviderForm((prev) => ({
                      ...prev,
                      enforceDistillableText: event.target.checked,
                    }))
                  }
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Restrict routing to models that permit text distillation.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Max price ($/m tokens)</p>
            <p className="text-sm text-slate-300">
              Cap prompt, completion, request, or image pricing for this turn.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Prompt</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="1.00"
                value={providerForm.maxPrompt}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxPrompt: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Completion</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="2.00"
                value={providerForm.maxCompletion}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxCompletion: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Request</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="0.25"
                value={providerForm.maxRequest}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxRequest: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Image</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="0.02"
                value={providerForm.maxImage}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxImage: event.target.value }))
                }
              />
            </label>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Need a refresher? Read the{' '}
          <a
            href="https://openrouter.ai/docs/features/provider-routing"
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 underline decoration-dotted underline-offset-4"
          >
            provider routing guide
          </a>{' '}
          for tips on building multi-provider policies.
        </p>
      </div>
    );
  };

  const renderMessages = () => {
    const dedupedOptimistic = optimisticMessages.filter((optimistic) => {
      const trimmedOptimistic = optimistic.content.trim();
      if (!trimmedOptimistic) {
        return false;
      }
      return !displayedMessages.some(
        (message) =>
          message.session_id === optimistic.session_id &&
          message.role === optimistic.role &&
          message.role === 'user' &&
          message.content.trim() === trimmedOptimistic,
      );
    });
    const allMessages = [...displayedMessages, ...dedupedOptimistic];
    if (allMessages.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-10 text-center">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Ready to chat</p>
            <h3 className="text-3xl font-semibold text-white">
              {collection ? collection.name : 'Select a collection'}
            </h3>
            <p className="text-sm text-slate-400">
              Ask anything about this dataset and we will cite the chunks that back it up.
            </p>
          </div>
          <div className="grid w-full max-w-3xl gap-3 md:grid-cols-2">
            {samplePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left text-sm text-slate-300 transition hover:border-white/30 hover:text-white"
                onClick={() => setDraft(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return allMessages.flatMap((message) => {
      const bubbles: ReactNode[] = [];
      const variant = roleVariants[message.role] ?? roleVariants.system;
      const isUser = message.role === 'user';
      const isAssistant = message.role === 'assistant';
      const showActions = (isUser || isAssistant) && !!selectedSessionId;
      const displayedContent = message.content?.trim() || 'No response captured.';
      const messageReasoningSegments = normalizeReasoningSegments(message.reasoning_trace);

      if (isAssistant) {
        const assistantSegments = messageReasoningSegments.filter(
          (segment) => !isToolReasoningSegment(segment),
        );
        if (assistantSegments.length > 0) {
          bubbles.push(
            <div
              key={`${message.id}-assistant-reasoning`}
              className={cn('rounded-2xl border px-4 py-3 text-sm', roleVariants.assistant)}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">Reasoning</p>
              </div>
              <CollapsibleReasoning
                segments={assistantSegments}
                messageId={`${message.id}-assistant-reasoning`}
              />
            </div>,
          );
        }
      }

      if (message.role === 'tool') {
        const trace = message.tool_call_id ? toolTraceMap.get(message.tool_call_id) : null;
        const toolSegments = trace
          ? normalizeReasoningSegments(trace.reasoning)
          : messageReasoningSegments;
        const toolLabel = trace?.name || message.tool_name || 'Tool';
        if (toolSegments.length > 0) {
          bubbles.push(
            <div
              key={`${message.id}-tool-reasoning`}
              className={cn('rounded-2xl border px-4 py-3 text-sm', roleVariants.assistant)}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">
                  Reasoning • {toolLabel}
                </p>
              </div>
              <CollapsibleReasoning segments={toolSegments} messageId={`${message.id}-tool-reasoning`} />
            </div>,
          );
        }

        const payloadRecord: Record<string, unknown> = trace
          ? { arguments: trace.arguments, response: trace.response }
          : coerceRecord(
              (message.tool_payload as Record<string, unknown> | null) ??
                safeParseJSON(message.content) ??
                {},
            );
        const argsRecord = coerceRecord(payloadRecord.arguments ?? {});
        const responseRecord = coerceRecord(payloadRecord.response ?? payloadRecord);
        bubbles.push(
          <div
            key={`${message.id}-tool`}
            className={cn('rounded-2xl border px-4 py-3 text-sm', roleVariants.tool)}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">
                Tool Call • {toolLabel}
              </p>
            </div>
            {Object.keys(argsRecord).length > 0 && (
              <div className="mb-3 space-y-1">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Arguments</p>
                <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-xs text-cyan-100">
                  {JSON.stringify(argsRecord, null, 2)}
                </pre>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Response</p>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-100">
                {JSON.stringify(responseRecord, null, 2)}
              </pre>
            </div>
          </div>,
        );
        return bubbles;
      }

      bubbles.push(
        <div key={message.id} className={cn('rounded-2xl border px-4 py-3 text-sm', variant)}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">
              {message.role.toUpperCase()}
              {message.tool_name ? ` • ${message.tool_name}` : ''}
            </p>
            {showActions && (
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                {isUser && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 hover:border-white/30 hover:text-white"
                    onClick={() => {
                      setEditingMessageId(message.id);
                      setEditingDraft(message.content);
                    }}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                )}
                {isAssistant && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 hover:border-white/30 hover:text-white"
                    onClick={() => handleRetryAssistant(message.id)}
                    disabled={sending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
          {isUser && editingMessageId === message.id ? (
            <div className="space-y-2">
              <textarea
                className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
                value={editingDraft}
                onChange={(event) => setEditingDraft(event.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={handleEditSubmit} loading={sending}>
                  Update & rerun
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setEditingMessageId(null);
                    setEditingDraft('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : message.role === 'assistant' ? (
            <div className="space-y-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {displayedContent}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayedContent}</p>
          )}
        </div>,
      );

      return bubbles;
    });
  };

  const renderHistoryList = () => (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">History</p>
          <h2 className="text-xl font-semibold text-white">Chat sessions</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
          onClick={() => setHistoryOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="border-b border-white/5 px-5 py-3">
        <Button
          variant="secondary"
          className="flex h-10 w-full items-center justify-center gap-2"
          onClick={handleStartNewChat}
        >
          <PlusCircle className="h-4 w-4" />
          <span>New chat</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {sessions.length === 0 ? (
          <p className="text-sm text-slate-400">No chats yet — start one below.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-2xl border px-2 py-2 text-sm transition',
                    isSelected
                      ? 'border-violet-400 bg-violet-500/10 text-white'
                      : 'border-white/5 bg-white/5 text-slate-300 hover:border-white/20',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      'flex-1 rounded-xl px-2 py-1 text-left',
                      isSelected ? 'text-white' : 'text-slate-300 group-hover:text-white',
                    )}
                  >
                    <p className="text-base font-semibold">{session.title}</p>
                    <p
                      className={cn(
                        'text-xs',
                        isSelected ? 'text-slate-300' : 'text-slate-400 group-hover:text-slate-200',
                      )}
                    >
                      {session.chat_model} • {timeAgo(session.updated_at)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(session.id)}
                    disabled={deletingSessionId === session.id}
                    title="Delete chat"
                    aria-label={`Delete ${session.title}`}
                    className={cn(
                      'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-slate-400 transition hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50',
                      isSelected
                        ? 'border-white/20 hover:border-rose-300/60'
                        : 'border-white/10 hover:border-rose-300/60',
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderTelemetry = () => {
    const usageCostLabel =
      usage?.cost != null
        ? `$${usage.cost.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}`
        : '—';

    const usageDescription = contextWindow
      ? `${contextConsumed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
      : `${contextConsumed.toLocaleString()} tokens consumed`;

    return (
      <div className="flex h-full flex-col min-h-0">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Context</p>
            <h2 className="text-xl font-semibold text-white">Run settings</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
            onClick={() => setTelemetryOpen(false)}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto">
          {renderModelSelector()}
          <TelemetrySection
            title="Provider routing"
            description={
              providerRuleCount === 0
                ? 'Load balance across top providers'
                : `${providerRuleCount} routing rule${providerRuleCount === 1 ? '' : 's'} configured`
            }
            icon={<Share2 className="h-4 w-4 text-emerald-300" />}
            isOpen={providerPreferencesOpen}
            onToggle={() => setProviderPreferencesOpen((prev) => !prev)}
          >
            {renderProviderControls()}
          </TelemetrySection>
          <TelemetrySection
            title="Collection vitals"
            description="Current ingestion settings"
            icon={<MessageCircle className="h-4 w-4 text-cyan-300" />}
            isOpen={vitalsOpen}
            onToggle={() => setVitalsOpen((prev) => !prev)}
          >
            {collection ? (
              <div className="space-y-2 text-sm text-slate-300">
                <p>
                  Documents: <span className="text-white">{documentCount}</span>
                </p>
                <p>
                  Embeddings: <span className="text-white">{collection.embedding_model}</span>
                </p>
                <p>
                  Chat model: <span className="text-white">{collection.chat_model}</span>
                </p>
                <p>
                  Chunking:{' '}
                  <span className="text-white">
                    {collection.chunk_settings.strategy} • {collection.chunk_settings.chunk_size}/
                    {collection.chunk_settings.chunk_overlap}
                  </span>
                </p>
                <p>
                  Context window:{' '}
                  <span className="text-white">
                    {collection.context_window.toLocaleString()} tokens
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Loading collection details…</p>
            )}
          </TelemetrySection>

          <TelemetrySection
            title="Model parameters"
            description={
              currentModelInfo
                ? `${activeParameterCount} override${activeParameterCount === 1 ? '' : 's'} active`
                : 'Load model metadata'
            }
            icon={<SlidersHorizontal className="h-4 w-4 text-violet-300" />}
            isOpen={modelParametersOpen}
            onToggle={() => setModelParametersOpen((prev) => !prev)}
          >
            {renderParameterControls()}
          </TelemetrySection>

          <TelemetrySection
            title="Usage"
            description={usageDescription}
            isOpen={usageOpen}
            onToggle={() => setUsageOpen((prev) => !prev)}
          >
            <div className="space-y-3 text-sm text-slate-300">
              <div className="space-y-1 text-xs uppercase tracking-[0.3em] text-slate-400">
                <span>Usage window</span>
                <span className="block text-sm text-slate-300">{usageDescription}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                  style={{ width: `${contextUtilization}%` }}
                />
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                    OpenRouter total cost
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">{usageCostLabel}</p>
                  <p className="text-[11px] text-slate-500">API cost for this session</p>
                </div>
                {usageMetrics.map((metric) => {
                  const metricValue = usage?.[metric.key];
                  const formattedValue =
                    metricValue != null ? metricValue.toLocaleString() : '—';
                  return (
                    <div
                      key={`${metric.key}`}
                      className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center"
                    >
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {metric.label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formattedValue}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </TelemetrySection>

        </div>
      </div>
    );
  };

return (
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
                {renderHistoryList()}
              </aside>
            )}
            {!historyOpen && (
              <button
                type="button"
                className="absolute left-4 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 hover:border-white/40 lg:flex"
                onClick={() => setHistoryOpen(true)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}

            <div className="flex min-w-0 flex-1 flex-col min-h-0">
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
                <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
                  <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
                    {renderMessages()}
                    <div ref={endRef} />
                  </div>
                </div>
                <div className="border-t border-white/5 bg-black/30 px-6 py-4">
                  <div className="flex flex-col gap-3">
                    <textarea
                      ref={chatPromptRef}
                      rows={1}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                      placeholder="Ask anything about this collection…"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      style={{
                        minHeight: CHAT_INPUT_MIN_HEIGHT,
                        maxHeight: CHAT_INPUT_MAX_HEIGHT,
                      }}
                    />
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{draft.length} characters</span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={handleSend}
                          loading={sending}
                          disabled={!draft.trim()}
                          className="gap-2"
                        >
                          Send turn
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {telemetryOpen && (
              <aside className="hidden h-full w-80 flex-shrink-0 border-l border-white/5 bg-black/40 p-6 lg:block">
                {renderTelemetry()}
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
  );
}
