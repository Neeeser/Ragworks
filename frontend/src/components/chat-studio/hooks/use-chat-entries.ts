"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  buildChatEntries,
  deriveToolTracesFromMessages,
  ensureMessageOrder,
  mergeMessageHistory,
  sortMessagesChronologically,
} from "@/components/chat-studio/chat-helpers";
import { formatToolLabel } from "@/components/chat-studio/Tooling";

import type { ChatEntry } from "@/components/chat-studio/chat-types";
import type { ChatMessage, ReasoningTraceSegment, ToolCallTrace } from "@/lib/types";

interface UseChatEntriesParams {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  optimisticMessages: ChatMessage[];
  toolTraces: ToolCallTrace[];
  selectedSessionId: string | null;
  resetStreamKeys: () => void;
}

export interface UseChatEntriesResult {
  chatEntries: ChatEntry[];
  chatEntryMap: Map<string, ChatEntry>;
  chatEntryOrder: string[];
  syncMessages: (
    incoming: ChatMessage[],
    options?: { hydrate?: boolean; resetStreamKeys?: boolean },
  ) => void;
  deriveToolTraces: (items: ChatMessage[]) => ToolCallTrace[];
  messageOrderRef: React.MutableRefObject<Map<string, number>>;
  nextMessageOrderRef: React.MutableRefObject<number>;
}

/**
 * Builds the rendered chat-entry list from persisted + optimistic messages, owns the
 * reasoning cache and message-order refs, and exposes the syncMessages / deriveToolTraces
 * helpers the history and write paths share. chatEntryOrder is derived directly from the
 * pure buildChatEntries output — no state written back from an effect.
 */
export function useChatEntries(params: UseChatEntriesParams): UseChatEntriesResult {
  const {
    messages,
    setMessages,
    optimisticMessages,
    toolTraces,
    selectedSessionId,
    resetStreamKeys,
  } = params;

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

  // buildChatEntries is a pure function; messageOrderRef only ever accumulates
  // stable per-message ordinals assigned outside of render (see syncMessages below),
  // so reading it here to derive chatEntries is the "recompute during render from a
  // ref that isn't written during render" pattern rather than a stateful side effect.
  /* eslint-disable react-hooks/refs -- see comment above; ref is read, not written, during render */
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
  /* eslint-enable react-hooks/refs */

  const chatEntryMap = useMemo(() => {
    const map = new Map<string, ChatEntry>();
    chatEntries.forEach((entry) => map.set(entry.id, entry));
    return map;
  }, [chatEntries]);

  const chatEntryOrder = useMemo(() => chatEntries.map((entry) => entry.id), [chatEntries]);

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
    [resetStreamKeys, setMessages],
  );

  const deriveToolTraces = useCallback(
    (items: ChatMessage[]) => deriveToolTracesFromMessages(items),
    [],
  );

  useEffect(() => {
    reasoningCacheRef.current.clear();
  }, [selectedSessionId]);

  return {
    chatEntries,
    chatEntryMap,
    chatEntryOrder,
    syncMessages,
    deriveToolTraces,
    messageOrderRef,
    nextMessageOrderRef,
  };
}
