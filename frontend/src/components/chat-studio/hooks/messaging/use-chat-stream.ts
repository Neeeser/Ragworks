"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  chatStreamReducer,
  initialChatStreamState,
} from "@/components/chat-studio/hooks/messaging/chat-stream-reducer";
import { makeToolId } from "@/components/chat-studio/lib/chat-helpers";

import type {
  ChatStreamState,
  LiveToolUpsert,
} from "@/components/chat-studio/hooks/messaging/chat-stream-reducer";
import type { ReasoningTraceSegment } from "@/lib/types";

export interface UseChatStreamResult extends ChatStreamState {
  /** Mirror of `isStreamingResponse` for synchronous reads (e.g. history polling). */
  isStreamingResponseRef: React.MutableRefObject<boolean>;
  /** Full reset shared by branch-for-edit and start-new-chat. */
  reset: () => void;
  /** Lighter reset applied just before a send is dispatched. */
  resetLiveMessage: () => void;
  /** Clears per-turn state at the start of a chat mutation. */
  beginMutation: () => void;
  /** Marks the streaming response active and records its entry key. */
  beginStream: (streamKey: string) => void;
  /** SSE token handler. */
  handleToken: (token: string) => void;
  /** SSE reasoning handler. */
  handleReasoning: (segments: ReasoningTraceSegment[] | null | undefined) => void;
  /** SSE tool-call handler. */
  handleToolCall: (event: LiveToolUpsert) => void;
  /** SSE tool-result handler. */
  handleToolResult: (event: LiveToolUpsert) => void;
  /** Flushes the in-progress reasoning segments into a completed block. */
  finalizeLiveReasoningBlock: () => void;
  /**
   * Completes the stream: finalizes the trailing reasoning block, records the final
   * assistant id / stream-key mapping, and returns the full streamed reasoning so the
   * caller can inject it into the persisted assistant message when needed.
   */
  completeStream: (finalAssistantId: string | null) => ReasoningTraceSegment[];
  /** Handles a failed / aborted stream. */
  failStream: (clearLive: boolean) => void;
  /** Clears the active stream key and the assistant-id → stream-key map (history hydration). */
  resetStreamKeys: () => void;
  /** Removes live tool events whose persisted counterparts have arrived. */
  pruneLiveToolEvents: (persistedToolIds: Set<string>) => void;
}

/**
 * Owns every live-stream UI value and the synchronous refs the SSE callbacks and the
 * completion path read. Consumers dispatch through the exposed imperative callbacks so
 * the refs and reducer stay consistent.
 */
export function useChatStream(): UseChatStreamResult {
  const [state, dispatch] = useReducer(chatStreamReducer, initialChatStreamState);

  const isStreamingResponseRef = useRef(false);
  const activeStreamEntryKeyRef = useRef<string | null>(null);
  const liveReasoningSegmentsRef = useRef<ReasoningTraceSegment[]>([]);
  const streamedReasoningAllRef = useRef<ReasoningTraceSegment[]>([]);
  const streamReasoningPhaseRef = useRef(0);

  useEffect(() => {
    isStreamingResponseRef.current = state.isStreamingResponse;
  }, [state.isStreamingResponse]);

  useEffect(() => {
    liveReasoningSegmentsRef.current = state.liveReasoningSegments;
  }, [state.liveReasoningSegments]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    activeStreamEntryKeyRef.current = null;
  }, []);

  const resetLiveMessage = useCallback(() => {
    dispatch({ type: "RESET_LIVE_MESSAGE" });
  }, []);

  const beginMutation = useCallback(() => {
    dispatch({ type: "MUTATION_STARTED" });
    isStreamingResponseRef.current = false;
    streamReasoningPhaseRef.current = 0;
    streamedReasoningAllRef.current = [];
  }, []);

  const beginStream = useCallback((streamKey: string) => {
    dispatch({ type: "STREAM_STARTED", streamKey });
    isStreamingResponseRef.current = true;
    activeStreamEntryKeyRef.current = streamKey;
  }, []);

  const handleToken = useCallback((token: string) => {
    dispatch({ type: "TOKEN", token });
  }, []);

  const handleReasoning = useCallback((segments: ReasoningTraceSegment[] | null | undefined) => {
    dispatch({ type: "REASONING_SET", segments: segments ?? [] });
  }, []);

  const finalizeLiveReasoningBlock = useCallback(() => {
    const currentSegments = liveReasoningSegmentsRef.current;
    if (currentSegments.length === 0) {
      return;
    }
    streamedReasoningAllRef.current = [...streamedReasoningAllRef.current, ...currentSegments];
    dispatch({
      type: "FINALIZE_REASONING_BLOCK",
      phaseIndex: streamReasoningPhaseRef.current,
      segments: currentSegments,
    });
  }, []);

  const handleToolCall = useCallback(
    (event: LiveToolUpsert) => {
      finalizeLiveReasoningBlock();
      const rawId = typeof event.id === "string" && event.id.trim() ? event.id.trim() : null;
      const toolId = rawId ?? makeToolId();
      const phaseIndex = streamReasoningPhaseRef.current;
      dispatch({
        type: "TOOL_CALL",
        toolId,
        phaseIndex,
        update: {
          id: toolId,
          name: event.name,
          arguments: event.arguments,
          reasoning: event.reasoning,
          collection_id: event.collection_id,
          collection_name: event.collection_name,
        },
      });
      streamReasoningPhaseRef.current = phaseIndex + 1;
    },
    [finalizeLiveReasoningBlock],
  );

  const handleToolResult = useCallback((event: LiveToolUpsert) => {
    const rawId = typeof event.id === "string" && event.id.trim() ? event.id.trim() : null;
    const toolId = rawId ?? makeToolId();
    const fallbackPhase = Math.max(0, streamReasoningPhaseRef.current - 1);
    dispatch({
      type: "TOOL_RESULT",
      toolId,
      fallbackPhase,
      update: {
        id: toolId,
        name: event.name,
        arguments: event.arguments,
        response: event.response,
        reasoning: event.reasoning,
        collection_id: event.collection_id,
        collection_name: event.collection_name,
      },
    });
  }, []);

  const completeStream = useCallback(
    (finalAssistantId: string | null) => {
      finalizeLiveReasoningBlock();
      const streamedReasoningSegments = streamedReasoningAllRef.current;
      dispatch({
        type: "STREAM_FINISHED",
        finalAssistantId,
        streamKey: activeStreamEntryKeyRef.current,
        streamedReasoningSegments,
      });
      streamedReasoningAllRef.current = [];
      return streamedReasoningSegments;
    },
    [finalizeLiveReasoningBlock],
  );

  const failStream = useCallback((clearLive: boolean) => {
    dispatch({ type: "STREAM_FAILED", clearLive });
    isStreamingResponseRef.current = false;
  }, []);

  const pruneLiveToolEvents = useCallback((persistedToolIds: Set<string>) => {
    dispatch({ type: "PRUNE_LIVE_TOOLS", persistedToolIds });
  }, []);

  const resetStreamKeys = useCallback(() => {
    dispatch({ type: "STREAM_KEYS_RESET" });
  }, []);

  return {
    ...state,
    isStreamingResponseRef,
    reset,
    resetLiveMessage,
    beginMutation,
    beginStream,
    handleToken,
    handleReasoning,
    handleToolCall,
    handleToolResult,
    finalizeLiveReasoningBlock,
    completeStream,
    failStream,
    resetStreamKeys,
    pruneLiveToolEvents,
  };
}
