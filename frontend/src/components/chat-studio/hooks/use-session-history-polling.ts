"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  calculateSessionUsage,
  deriveToolTracesFromMessages,
} from "@/components/chat-studio/chat-helpers";
import { getChatHistory } from "@/lib/api";

import type { ChatMessage, ToolCallTrace, UsageBreakdown } from "@/lib/types";

const PROGRESS_POLL_INTERVAL = 800;

interface SyncMessagesFn {
  (
    incoming: ChatMessage[],
    options?: { hydrate?: boolean; resetStreamKeys?: boolean },
  ): void;
}

interface UseSessionHistoryPollingParams {
  authToken: string;
  selectedSessionId: string | null;
  /** Mirror of the streaming flag; polling pauses while a stream is active. */
  isStreamingResponseRef: React.MutableRefObject<boolean>;
  syncMessages: SyncMessagesFn;
  setToolTraces: (traces: ToolCallTrace[]) => void;
  setUsage: (usage: UsageBreakdown | null) => void;
}

interface UseSessionHistoryPollingResult {
  startProgressPolling: (sessionId: string) => void;
  stopProgressPolling: () => void;
}

/**
 * Polls chat history for non-streaming turns so tool calls and usage reveal
 * progressively. Owns the interval and active-session refs, pauses while a stream
 * is live, and stops automatically when the selected session changes or unmounts.
 */
export function useSessionHistoryPolling({
  authToken,
  selectedSessionId,
  isStreamingResponseRef,
  syncMessages,
  setToolTraces,
  setUsage,
}: UseSessionHistoryPollingParams): UseSessionHistoryPollingResult {
  const pollIntervalRef = useRef<number | null>(null);
  const activePollingSession = useRef<string | null>(null);

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
        setToolTraces(deriveToolTracesFromMessages(history));
        setUsage(calculateSessionUsage(history));
      } catch {
        // swallow transient polling errors
      }
    },
    [authToken, isStreamingResponseRef, syncMessages, setToolTraces, setUsage],
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

  return { startProgressPolling, stopProgressPolling };
}
