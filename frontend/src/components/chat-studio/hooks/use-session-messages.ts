"use client";

import { useEffect } from "react";

import {
  calculateSessionUsage,
  isOptimisticDuplicate,
} from "@/components/chat-studio/chat-entry-helpers";
import { getChatHistory } from "@/lib/api";

import type { ChatStudioCoreState } from "@/components/chat-studio/hooks/use-chat-studio-state";
import type { ChatMessage, ToolCallTrace } from "@/lib/types";

export interface UseSessionMessagesParams extends ChatStudioCoreState {
  authToken: string;
  selectedSessionId: string | null;
  messageOrderRef: React.MutableRefObject<Map<string, number>>;
  syncMessages: (
    incoming: ChatMessage[],
    options?: { hydrate?: boolean; resetStreamKeys?: boolean },
  ) => void;
  deriveToolTraces: (items: ChatMessage[]) => ToolCallTrace[];
  pruneLiveToolEvents: (persistedToolIds: Set<string>) => void;
}

/**
 * Owns the message-data lifecycle for the selected session: history hydration, the
 * optimistic-message clear/dedup passes, context-token sync, and pruning live tool
 * events once their persisted counterparts arrive.
 */
export function useSessionMessages(params: UseSessionMessagesParams): void {
  const {
    authToken,
    selectedSessionId,
    messageOrderRef,
    syncMessages,
    deriveToolTraces,
    pruneLiveToolEvents,
    sessions,
    messages,
    setMessages,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setOptimisticMessages,
    setStatus,
    pendingSessionIdsRef,
    skipHistoryFetchSessionRef,
  } = params;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, selectedSessionId, syncMessages, deriveToolTraces]);

  useEffect(() => {
    if (!selectedSessionId) {
      setOptimisticMessages([]);
      return;
    }
    setOptimisticMessages((prev) =>
      prev.filter((message) => message.session_id === selectedSessionId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (!selectedSessionId) {
      setContextConsumed(0);
      return;
    }
    const active = sessions.find((session) => session.id === selectedSessionId);
    if (active) {
      setContextConsumed(active.context_tokens);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, sessions]);

  // Remove live tool events once their persisted counterparts are present.
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
}
