'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Play, Sparkles, Waves } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/panel';
import { Loader } from '@/components/ui/loader';
import {
  chatWithCollection,
  fetchCollections,
  getChatHistory,
  listChatSessions,
} from '@/lib/api';
import type {
  ChatMessage,
  ChatSession,
  Collection,
  ToolCallTrace,
  UsageBreakdown,
} from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const samplePrompts = [
  'Summarize the latest ingestion with citations.',
  'What chunking strategy is this collection using?',
  'Show me the last Pinecone tool call and its score distribution.',
];

const safeParseJSON = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export default function ChatPage() {
  const { token } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolCallTrace[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(0);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const authToken = token ?? '';
    if (!authToken) return;
    let cancelled = false;
    async function loadCollections(currentToken: string) {
      setLoading(true);
      try {
        const data = await fetchCollections(currentToken);
        if (!cancelled) {
          setCollections(data);
          if (data.length > 0) {
            setSelectedCollection(data[0]);
          }
        }
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Unable to load data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadCollections(authToken);
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const authToken = token ?? '';
    const collection = selectedCollection;
    if (!authToken || !collection) {
      setSessions([]);
      setSelectedSessionId(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    async function loadSessions(currentToken: string, collectionId: string) {
      try {
        const data = await listChatSessions(collectionId, currentToken);
        if (!cancelled) {
          setSessions(data);
          setSelectedSessionId(data[0]?.id ?? null);
        }
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Unable to load sessions.');
      }
    }
    loadSessions(authToken, collection.id);
    return () => {
      cancelled = true;
    };
  }, [selectedCollection, token]);

  useEffect(() => {
    const authToken = token ?? '';
    if (!authToken || !selectedSessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    async function loadHistory(currentToken: string, sessionId: string) {
      try {
        const history = await getChatHistory(sessionId, currentToken);
        if (!cancelled) {
          setMessages(history);
          setToolTraces([]);
          setUsage(null);
        }
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Unable to load history.');
      }
    }
    loadHistory(authToken, selectedSessionId);
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, token]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const authToken = token ?? '';
    const activeCollection = selectedCollection;
    if (!authToken || !activeCollection || !draft.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const response = await chatWithCollection(
        activeCollection.id,
        {
          content: draft.trim(),
          session_id: selectedSessionId || undefined,
          mode: 'chat',
          title: selectedSessionId ? undefined : `Chat ${new Date().toLocaleTimeString()}`,
        },
        authToken,
      );
      setMessages(response.messages);
      setToolTraces(response.tool_traces);
      setUsage(response.usage);
      setContextConsumed(response.context_consumed);
      setContextWindow(response.context_window || activeCollection.context_window);
      setSelectedSessionId(response.session.id);
      setSessions((prev) => {
        const existingIndex = prev.findIndex((s) => s.id === response.session.id);
        if (existingIndex >= 0) {
          const copy = [...prev];
          copy[existingIndex] = response.session;
          return copy;
        }
        return [response.session, ...prev];
      });
      setDraft('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const contextUtilization = useMemo(() => {
    if (!contextWindow) return 0;
    return Math.min(100, Math.round((contextConsumed / contextWindow) * 100));
  }, [contextConsumed, contextWindow]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Chat studio</p>
        <h1 className="text-3xl font-semibold text-white">
          Inspect tool-aware chats across your collections.
        </h1>
      </div>

      {status && (
        <GlassCard className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {status}
        </GlassCard>
      )}

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-3xl p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <GlassCard className="rounded-3xl p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Collections</p>
                  <h2 className="text-xl font-semibold">Select workspace</h2>
                </div>
                <MessageCircle className="h-5 w-5 text-violet-300" />
              </div>
              <div className="mt-5 space-y-3">
                {collections.length === 0 && (
                  <p className="text-sm text-slate-400">
                    Create a collection first to start chatting.
                  </p>
                )}
                {collections.map((collection) => (
                  <button
                    type="button"
                    key={collection.id}
                    onClick={() => setSelectedCollection(collection)}
                    className={cn(
                      'w-full rounded-2xl border px-4 py-3 text-left text-sm transition',
                      selectedCollection?.id === collection.id
                        ? 'border-violet-400 bg-violet-500/10 text-white'
                        : 'border-white/5 bg-white/5 text-slate-300 hover:border-white/20',
                    )}
                  >
                    <p className="text-base font-semibold">{collection.name}</p>
                    <p className="text-xs text-slate-400">{collection.chat_model}</p>
                  </button>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Sessions</p>
                  <h2 className="text-xl font-semibold">History</h2>
                </div>
                <Waves className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-slate-400">No sessions yet.</p>
                ) : (
                  sessions.map((session) => (
                    <button
                      type="button"
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      className={cn(
                        'rounded-2xl border px-4 py-3 text-left text-sm transition',
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
                  ))
                )}
              </div>
            </GlassCard>

            <GlassCard className="rounded-3xl p-6">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Prompts</p>
              <div className="mt-4 flex flex-col gap-3">
                {samplePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-left text-sm text-slate-300 hover:border-white/20"
                    onClick={() => setDraft(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </GlassCard>
          </div>

          <div className="space-y-6">
            <GlassCard className="rounded-3xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">
                    Conversation
                  </p>
                  <h2 className="text-2xl font-semibold">
                    {selectedCollection ? selectedCollection.name : 'Select a collection'}
                  </h2>
                </div>
                <Sparkles className="h-5 w-5 text-violet-300" />
              </div>

              <div className="mt-6 max-h-[420px] space-y-4 overflow-y-auto pr-2">
                {messages.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Send a message to start a transparent chat session.
                  </p>
                ) : (
                  messages.flatMap((message) => {
                    const bubbles: ReactNode[] = [];
                    const variantClasses: Record<
                      'user' | 'assistant' | 'tool' | 'reasoning' | 'system',
                      string
                    > = {
                      user: 'border-violet-500/40 bg-violet-500/15 text-violet-50',
                      assistant: 'border-white/15 bg-white/10 text-white',
                      tool: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50',
                      reasoning: 'border-amber-400/40 bg-amber-500/10 text-amber-50',
                      system: 'border-slate-500/30 bg-slate-800 text-slate-100',
                    };

                    const roleLabel = message.role.toUpperCase();
                    const variant =
                      variantClasses[message.role as keyof typeof variantClasses] ??
                      variantClasses.system;
                    const parsedToolPayload =
                      message.role === 'tool'
                        ? message.tool_payload ?? safeParseJSON(message.content)
                        : null;
                    const displayedContent =
                      parsedToolPayload != null
                        ? JSON.stringify(parsedToolPayload, null, 2)
                        : message.content?.trim() || 'No assistant response generated.';

                    bubbles.push(
                      <div
                        key={message.id}
                        className={cn('rounded-2xl border px-4 py-3 text-sm', variant)}
                      >
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">
                          {roleLabel}
                          {message.tool_name ? ` • ${message.tool_name}` : ''}
                        </p>
                        <pre className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                          {displayedContent}
                        </pre>
                      </div>,
                    );

                    const reasoningSegments = message.reasoning_trace?.segments ?? [];
                    reasoningSegments.forEach((segment, idx) => {
                      const reasoningLabel = `REASONING • Step ${idx + 1}`;
                      const reasoningText =
                        (typeof segment.text === 'string' && segment.text.trim()) ||
                        (typeof segment.content === 'string' && segment.content.trim()) ||
                        JSON.stringify(segment, null, 2);
                      bubbles.push(
                        <div
                          key={`${message.id}-reasoning-${idx}`}
                          className={cn(
                            'rounded-2xl border px-4 py-3 text-sm',
                            variantClasses.reasoning,
                          )}
                        >
                          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">
                            {reasoningLabel}
                          </p>
                          <pre className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                            {reasoningText}
                          </pre>
                        </div>,
                      );
                    });
                    return bubbles;
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="mt-6 flex flex-col gap-3">
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                  placeholder="Ask anything about this collection…"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">{draft.length} characters</p>
                  <Button
                    type="button"
                    onClick={handleSend}
                    loading={sending}
                    className="flex items-center gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="rounded-3xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Telemetry</p>
                  <h2 className="text-xl font-semibold">Tool traces & usage</h2>
                </div>
                <span className="text-sm text-slate-400">
                  {contextConsumed.toLocaleString()} / {contextWindow.toLocaleString()} tokens
                </span>
              </div>
              <div className="mt-4 h-3 w-full rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                  style={{ width: `${contextUtilization}%` }}
                />
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {['prompt_tokens', 'completion_tokens', 'total_tokens'].map((key) => (
                  <div key={key} className="rounded-2xl border border-white/5 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{key}</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {usage?.[key as keyof UsageBreakdown]?.toLocaleString() ?? '—'}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-6 space-y-3">
                {toolTraces.length === 0 ? (
                  <p className="text-sm text-slate-400">Run a chat turn to capture tool traces.</p>
                ) : (
                  toolTraces.map((trace) => (
                    <div key={trace.id} className="rounded-2xl border border-white/5 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {trace.name}
                      </p>
                      <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-200">
                        {JSON.stringify(trace.arguments, null, 2)}
                      </pre>
                      {trace.response && (
                        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-cyan-200">
                          {JSON.stringify(trace.response, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}
