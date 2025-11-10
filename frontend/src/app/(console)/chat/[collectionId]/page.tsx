'use client';

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  Edit3,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PlusCircle,
  RotateCcw,
  Waves,
} from 'lucide-react';
import type { Components } from 'react-markdown';

import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/panel';
import { Loader } from '@/components/ui/loader';
import { CollapsibleReasoning } from '@/components/ui/collapsible-reasoning';
import {
  chatWithCollection,
  fetchCollections,
  fetchDocuments,
  getChatHistory,
  listChatSessions,
} from '@/lib/api';
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
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

const safeParseJSON = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
  const [historyOpen, setHistoryOpen] = useState(true);
  const [telemetryOpen, setTelemetryOpen] = useState(true);
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
      setContextConsumed(0);
      return;
    }
    const activeSession = sessions.find((session) => session.id === selectedSessionId);
    if (activeSession) {
      setContextConsumed(activeSession.context_tokens);
    }
  }, [selectedSessionId, sessions]);

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

  const displayedToolTraces = useMemo(() => {
    const visibleToolCallIds = new Set(
      displayedMessages
        .filter((message) => message.role === 'tool' && message.tool_call_id)
        .map((message) => message.tool_call_id as string),
    );
    if (visibleToolCallIds.size === 0) {
      return [];
    }
    return toolTraces.filter((trace) => visibleToolCallIds.has(trace.id));
  }, [displayedMessages, toolTraces]);

  const toolTraceMap = useMemo(() => {
    const map = new Map<string, ToolCallTrace>();
    toolTraces.forEach((trace) => map.set(trace.id, trace));
    return map;
  }, [toolTraces]);


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
    if (!authToken || !collection || !draft.trim()) return;
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
        chat_model: collection.chat_model,
        context_tokens: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSessions((prev) => sortSessions([...prev, placeholderSession]));
      pendingSessionIdsRef.current.add(sessionId);
    }
    if (!sessionId) return;
    try {
      await performChatMutation(sessionId, {
        content: draft.trim(),
        mode: 'chat',
        title: isNewSession ? `Chat ${new Date().toLocaleTimeString()}` : undefined,
      });
      setDraft('');
    } catch (error) {
      if (isNewSession && sessionId) {
        pendingSessionIdsRef.current.delete(sessionId);
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        setSelectedSessionId(null);
      }
      setStatus(error instanceof Error ? error.message : 'Unable to send your message.');
    }
  };

  const runEditMutation = async (messageId: string, newContent: string) => {
    if (!authToken || !collection || !selectedSessionId) return;
    try {
      await performChatMutation(selectedSessionId, {
        content: newContent,
        edit_message_id: messageId,
        mode: 'chat',
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
  };

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

  const renderMessages = () => {
    if (displayedMessages.length === 0) {
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

    return displayedMessages.flatMap((message) => {
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
            {sessions.map((session) => (
              <button
                type="button"
                key={session.id}
                onClick={() => setSelectedSessionId(session.id)}
                className={cn(
                  'w-full rounded-2xl border px-4 py-3 text-left text-sm transition',
                  selectedSessionId === session.id
                    ? 'border-violet-400 bg-violet-500/10 text-white'
                    : 'border-white/5 bg-white/5 text-slate-300 hover:border-white/20',
                )}
              >
                <p className="text-base font-semibold">{session.title}</p>
                <p className="text-xs text-slate-400">
                  {session.chat_model} • {timeAgo(session.updated_at)}
                </p>
              </button>
            ))}
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
        {collection && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
              <MessageCircle className="h-4 w-4 text-cyan-300" />
              Collection vitals
            </div>
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
              Context window: <span className="text-white">{collection.context_window.toLocaleString()} tokens</span>
            </p>
          </div>
        )}

        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="space-y-1 text-xs uppercase tracking-[0.3em] text-slate-400">
            <span>Usage</span>
            <span className="block text-sm text-slate-300">
              {contextConsumed.toLocaleString()} / {contextWindow.toLocaleString()} tokens
            </span>
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
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formattedValue}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
            <span>Tool traces</span>
            <Waves className="h-4 w-4 text-cyan-300" />
          </div>
          {displayedToolTraces.length === 0 ? (
            <p className="text-sm text-slate-400">Trigger a chat turn to capture tool traces.</p>
          ) : (
            <div className="space-y-3">
              {displayedToolTraces.map((trace) => (
                <div key={trace.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{trace.name}</p>
                  <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-200">
                    {JSON.stringify(trace.arguments, null, 2)}
                  </pre>
                  {trace.response && (
                    <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-xs text-cyan-200">
                      {JSON.stringify(trace.response, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
