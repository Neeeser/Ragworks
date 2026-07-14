"use client";

import { useRef, useState } from "react";

import { DEFAULT_STREAMING_ENABLED } from "@/components/chat-studio/lib/chat-constants";

import type { NewChatDefaults } from "@/components/chat-studio/hooks/messaging/chat-mutation-helpers";
import type { ChatMessage, ChatSession, ToolCallTrace, UsageBreakdown } from "@/lib/types";

type Dispatch<T> = React.Dispatch<React.SetStateAction<T>>;

/**
 * All of ChatStudio's plain component state and cross-cutting refs, gathered into one
 * hook so the orchestrator can spread the bag into the write-path / lifecycle hooks
 * instead of threading dozens of individual setters by hand.
 */
export interface ChatStudioCoreState {
  sessions: ChatSession[];
  setSessions: Dispatch<ChatSession[]>;
  messages: ChatMessage[];
  setMessages: Dispatch<ChatMessage[]>;
  toolTraces: ToolCallTrace[];
  setToolTraces: Dispatch<ToolCallTrace[]>;
  usage: UsageBreakdown | null;
  setUsage: Dispatch<UsageBreakdown | null>;
  contextConsumed: number;
  setContextConsumed: Dispatch<number>;
  draft: string;
  setDraft: Dispatch<string>;
  status: string | null;
  setStatus: Dispatch<string | null>;
  loading: boolean;
  setLoading: Dispatch<boolean>;
  sending: boolean;
  setSending: Dispatch<boolean>;
  isStopping: boolean;
  setIsStopping: Dispatch<boolean>;
  editingMessageId: string | null;
  setEditingMessageId: Dispatch<string | null>;
  editingDraft: string;
  setEditingDraft: Dispatch<string>;
  optimisticMessages: ChatMessage[];
  setOptimisticMessages: Dispatch<ChatMessage[]>;
  deletingSessionId: string | null;
  setDeletingSessionId: Dispatch<string | null>;
  streamingEnabled: boolean;
  setStreamingEnabled: Dispatch<boolean>;
  activeModelId: string | null;
  activeConnectionId: string | null;
  setActiveModelId: Dispatch<string | null>;
  setActiveConnectionId: Dispatch<string | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  branchedSessionOriginRef: React.MutableRefObject<Map<string, "edit" | "manual">>;
  skipHistoryFetchSessionRef: React.MutableRefObject<string | null>;
  applyNewChatDefaultsRef: React.MutableRefObject<boolean>;
  pendingSessionIdsRef: React.MutableRefObject<Set<string>>;
  newChatDefaultsRef: React.MutableRefObject<NewChatDefaults | null>;
  previousModelIdRef: React.MutableRefObject<string | null>;
}

export function useChatStudioState(): ChatStudioCoreState {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolCallTrace[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  // Defaults to the loading state; a previously-loaded session is detected after mount.
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [streamingEnabled, setStreamingEnabled] = useState(DEFAULT_STREAMING_ENABLED);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const branchedSessionOriginRef = useRef(new Map<string, "edit" | "manual">());
  const skipHistoryFetchSessionRef = useRef<string | null>(null);
  const applyNewChatDefaultsRef = useRef(true);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());
  const newChatDefaultsRef = useRef<NewChatDefaults | null>(null);
  const previousModelIdRef = useRef<string | null>(null);

  return {
    sessions,
    setSessions,
    messages,
    setMessages,
    toolTraces,
    setToolTraces,
    usage,
    setUsage,
    contextConsumed,
    setContextConsumed,
    draft,
    setDraft,
    status,
    setStatus,
    loading,
    setLoading,
    sending,
    setSending,
    isStopping,
    setIsStopping,
    editingMessageId,
    setEditingMessageId,
    editingDraft,
    setEditingDraft,
    optimisticMessages,
    setOptimisticMessages,
    deletingSessionId,
    setDeletingSessionId,
    streamingEnabled,
    setStreamingEnabled,
    activeModelId,
    activeConnectionId,
    setActiveModelId,
    setActiveConnectionId,
    abortControllerRef,
    branchedSessionOriginRef,
    skipHistoryFetchSessionRef,
    applyNewChatDefaultsRef,
    pendingSessionIdsRef,
    newChatDefaultsRef,
    previousModelIdRef,
  };
}
