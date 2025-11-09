'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
  ChatSession,
  Collection,
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

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{children}</p>
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

  const authToken = token ?? '';

  const sortSessions = (items: ChatSession[]) =>
    [...items].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

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
  }, [authToken, collectionId]);

  useEffect(() => {
    if (!authToken) return;
    if (!selectedSessionId) {
      setMessages([]);
      setToolTraces([]);
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      try {
        const history = await getChatHistory(selectedSessionId, authToken);
        if (!cancelled) {
          setMessages(history);
          setToolTraces([]);
          setUsage(null);
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
  }, [authToken, selectedSessionId]);

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
  }, [messages]);

  const contextUtilization = useMemo(() => {
    if (!contextWindow) return 0;
    return Math.min(100, Math.round((contextConsumed / contextWindow) * 100));
  }, [contextConsumed, contextWindow]);

  const applyChatResponse = (response: ChatCompletionPayload) => {
    setMessages(response.messages);
    setToolTraces(response.tool_traces);
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
  };

  const handleSend = async () => {
    if (!authToken || !collection || !draft.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const result = await chatWithCollection(
        collection.id,
        {
          content: draft.trim(),
          session_id: selectedSessionId || undefined,
          mode: 'chat',
          title: selectedSessionId ? undefined : `Chat ${new Date().toLocaleTimeString()}`,
        },
        authToken,
      );
      applyChatResponse(result);
      setDraft('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to send your message.');
    } finally {
      setSending(false);
    }
  };

  const runEditMutation = async (messageId: string, newContent: string) => {
    if (!authToken || !collection || !selectedSessionId) return;
    setSending(true);
    setStatus(null);
    try {
      const result = await chatWithCollection(
        collection.id,
        {
          content: newContent,
          session_id: selectedSessionId,
          edit_message_id: messageId,
          mode: 'chat',
        },
        authToken,
      );
      applyChatResponse(result);
      setEditingMessageId(null);
      setEditingDraft('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to edit this turn.');
    } finally {
      setSending(false);
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
    setSelectedSessionId(null);
    setMessages([]);
    setToolTraces([]);
    setUsage(null);
    setContextConsumed(0);
    setDraft('');
    setEditingMessageId(null);
    setEditingDraft('');
  };

  const roleVariants: Record<string, string> = {
    user: 'border-violet-500/40 bg-violet-500/15 text-violet-50',
    assistant: 'border-white/15 bg-white/10 text-white',
    tool: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50',
    system: 'border-slate-500/30 bg-slate-900/60 text-slate-100',
  };

  const renderMessages = () => {
    if (messages.length === 0) {
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

    return messages.flatMap((message) => {
      const bubbles: ReactNode[] = [];
      const variant = roleVariants[message.role] ?? roleVariants.system;
      const isUser = message.role === 'user';
      const isAssistant = message.role === 'assistant';
      const showActions = (isUser || isAssistant) && !!selectedSessionId;
      const displayedContent = message.content?.trim() || 'No response captured.';
      const parsedToolPayload =
        message.role === 'tool' ? message.tool_payload ?? safeParseJSON(message.content) : null;

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
          ) : message.role === 'tool' ? (
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-cyan-100">
              {JSON.stringify(parsedToolPayload ?? displayedContent, null, 2)}
            </pre>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayedContent}</p>
          )}
        </div>,
      );

      const reasoningSegments = message.reasoning_trace?.segments ?? [];
      reasoningSegments.forEach((segment, idx) => {
        const reasoningText =
          (typeof segment.text === 'string' && segment.text.trim()) ||
          (typeof segment.content === 'string' && segment.content.trim()) ||
          JSON.stringify(segment, null, 2);
        bubbles.push(
          <div
            key={`${message.id}-reasoning-${idx}`}
            className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-50"
          >
            <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">REASONING • Step {idx + 1}</p>
            <pre className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{reasoningText}</pre>
          </div>,
        );
      });
      return bubbles;
    });
  };

  const renderHistoryList = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">History</p>
          <h2 className="text-xl font-semibold text-white">Chat sessions</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 rounded-full border border-white/10 p-0 text-slate-300"
          onClick={() => setHistoryOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
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
      <div className="border-t border-white/5 px-5 py-4">
        <Button variant="secondary" className="w-full" onClick={handleStartNewChat}>
          <PlusCircle className="mr-2 h-4 w-4" />
          New chat
        </Button>
      </div>
    </div>
  );

  const renderTelemetry = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Context</p>
          <h2 className="text-xl font-semibold text-white">Run settings</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 rounded-full border border-white/10 p-0 text-slate-300"
          onClick={() => setTelemetryOpen(false)}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-4 flex-1 space-y-4 overflow-y-auto">
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
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
            <span>Usage</span>
            <span>
              {contextConsumed.toLocaleString()} / {contextWindow.toLocaleString()} tokens
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
              style={{ width: `${contextUtilization}%` }}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {['prompt_tokens', 'completion_tokens', 'total_tokens'].map((key) => (
              <div key={key} className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{key}</p>
                <p className="mt-1 text-2xl font-semibold">
                  {usage?.[key as keyof UsageBreakdown]?.toLocaleString() ?? '—'}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
            <span>Tool traces</span>
            <Waves className="h-4 w-4 text-cyan-300" />
          </div>
          {toolTraces.length === 0 ? (
            <p className="text-sm text-slate-400">Trigger a chat turn to capture tool traces.</p>
          ) : (
            <div className="space-y-3">
              {toolTraces.map((trace) => (
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Chat studio</p>
          <h1 className="text-3xl font-semibold text-white">
            {collection ? collection.name : 'Loading collection…'}
          </h1>
          {collection && (
            <p className="mt-1 text-sm text-slate-400">{collection.description || 'No description provided yet.'}</p>
          )}
        </div>
        <Button variant="ghost" className="gap-2" onClick={() => router.push('/chat')}>
          <ArrowLeft className="h-4 w-4" /> Collections
        </Button>
      </div>

      {status && (
        <GlassCard className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {status}
        </GlassCard>
      )}

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-[2rem] p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : !collection ? (
        <GlassCard className="rounded-[2rem] p-10 text-center text-sm text-slate-300">
          Unable to load this collection.
        </GlassCard>
      ) : (
        <div className="glass-panel relative flex h-[calc(100vh-8rem)] min-h-[720px] overflow-hidden rounded-[2.5rem] border border-white/5 bg-slate-950/80">
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

          <div className="flex min-w-0 flex-1 flex-col">
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 w-10 rounded-full border border-white/10 p-0 text-slate-300"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                >
                  {historyOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </Button>
                <Button variant="secondary" className="gap-2" onClick={handleStartNewChat}>
                  <PlusCircle className="h-4 w-4" />
                  New chat
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 w-10 rounded-full border border-white/10 p-0 text-slate-300"
                  onClick={() => setTelemetryOpen((prev) => !prev)}
                >
                  {telemetryOpen ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
                  {renderMessages()}
                  <div ref={endRef} />
                </div>
              </div>
              <div className="border-t border-white/5 bg-black/30 px-6 py-4">
                <div className="flex flex-col gap-3">
                  <textarea
                    className="h-36 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                    placeholder="Ask anything about this collection…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
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
  );
}
