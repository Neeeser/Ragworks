"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { makeToolId } from "@/components/chat-studio/chat-helpers";
import { normalizeReasoningSegments } from "@/components/chat-studio/chat-utils";

import type { ReasoningTraceSegment, ToolCallTrace } from "@/lib/types";

/** Shape of an incremental tool-call/result update fed into the live tool list. */
export interface LiveToolUpsert {
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  response?: Record<string, unknown>;
  reasoning?: unknown;
  collection_id?: string;
  collection_name?: string;
}

/**
 * All live-stream UI state, owned by a single reducer so the many token / reasoning /
 * tool-event mutations share one predictable transition table instead of ~16 scattered
 * `useState` setters plus three copy-pasted reset blocks.
 */
export interface ChatStreamState {
  liveResponse: string;
  isStreamingResponse: boolean;
  liveReasoningSegments: ReasoningTraceSegment[];
  liveReasoningBlocks: ReasoningTraceSegment[][];
  liveReasoningPhase: number;
  persistedLiveReasoningSegments: ReasoningTraceSegment[];
  activeStreamEntryKey: string | null;
  finalStreamAssistantId: string | null;
  streamEntryKeyMap: Record<string, string>;
  liveToolEvents: ToolCallTrace[];
  liveToolOrder: string[];
  liveToolPhaseById: Record<string, number>;
  liveResponseAnimationKey: number;
  liveReasoningAnimationKey: number;
}

export const initialChatStreamState: ChatStreamState = {
  liveResponse: "",
  isStreamingResponse: false,
  liveReasoningSegments: [],
  liveReasoningBlocks: [],
  liveReasoningPhase: 0,
  persistedLiveReasoningSegments: [],
  activeStreamEntryKey: null,
  finalStreamAssistantId: null,
  streamEntryKeyMap: {},
  liveToolEvents: [],
  liveToolOrder: [],
  liveToolPhaseById: {},
  liveResponseAnimationKey: 0,
  liveReasoningAnimationKey: 0,
};

export type ChatStreamAction =
  /** Single reset path shared by branch-for-edit and start-new-chat. */
  | { type: "RESET" }
  /** Lighter reset used right before dispatching a send (mutation start refines it). */
  | { type: "RESET_LIVE_MESSAGE" }
  /** Clears per-turn live state at the start of a chat mutation (keeps stream-key map). */
  | { type: "MUTATION_STARTED" }
  | { type: "STREAM_STARTED"; streamKey: string }
  | { type: "TOKEN"; token: string }
  | { type: "REASONING_SET"; segments: ReasoningTraceSegment[] }
  | { type: "FINALIZE_REASONING_BLOCK"; phaseIndex: number; segments: ReasoningTraceSegment[] }
  | { type: "TOOL_CALL"; toolId: string; phaseIndex: number; update: LiveToolUpsert }
  | { type: "TOOL_RESULT"; toolId: string; fallbackPhase: number; update: LiveToolUpsert }
  | {
      type: "STREAM_FINISHED";
      finalAssistantId: string | null;
      streamKey: string | null;
      streamedReasoningSegments: ReasoningTraceSegment[];
    }
  | { type: "STREAM_FAILED"; clearLive: boolean }
  | { type: "STREAM_KEYS_RESET" }
  | { type: "PRUNE_LIVE_TOOLS"; persistedToolIds: Set<string> };

/** Pure upsert into the live tool-event list, merging incremental fields onto any existing entry. */
export function upsertLiveToolEvents(
  events: ToolCallTrace[],
  update: LiveToolUpsert,
): ToolCallTrace[] {
  const eventId = update.id || makeToolId();
  const reasoningSegments =
    update.reasoning !== undefined ? normalizeReasoningSegments(update.reasoning) : undefined;
  const next = [...events];
  const existingIndex = next.findIndex((item) => item.id === eventId);
  const base =
    existingIndex >= 0
      ? next[existingIndex]
      : {
          id: eventId,
          name: update.name || "tool_call",
          arguments: {},
          response: {},
          reasoning: null as ToolCallTrace["reasoning"],
          collection_id: update.collection_id ?? null,
          collection_name: update.collection_name ?? null,
        };
  const merged = {
    ...base,
    name: update.name || base.name,
    arguments: { ...base.arguments, ...(update.arguments || {}) },
    response: update.response !== undefined ? update.response || {} : base.response || {},
    collection_id: update.collection_id ?? base.collection_id ?? null,
    collection_name: update.collection_name ?? base.collection_name ?? null,
    reasoning:
      reasoningSegments && reasoningSegments.length > 0
        ? { segments: reasoningSegments }
        : (base.reasoning ?? null),
  };
  if (existingIndex >= 0) {
    next[existingIndex] = merged;
    return next;
  }
  return [...next, merged];
}

export function chatStreamReducer(
  state: ChatStreamState,
  action: ChatStreamAction,
): ChatStreamState {
  switch (action.type) {
    case "RESET":
      return {
        ...state,
        liveResponse: "",
        isStreamingResponse: false,
        finalStreamAssistantId: null,
        streamEntryKeyMap: {},
        activeStreamEntryKey: null,
        liveReasoningSegments: [],
        liveReasoningBlocks: [],
        liveReasoningPhase: 0,
        persistedLiveReasoningSegments: [],
      };
    case "RESET_LIVE_MESSAGE":
      return {
        ...state,
        liveResponse: "",
        isStreamingResponse: false,
        liveReasoningSegments: [],
        liveReasoningBlocks: [],
        liveReasoningPhase: 0,
        persistedLiveReasoningSegments: [],
      };
    case "MUTATION_STARTED":
      return {
        ...state,
        liveResponse: "",
        isStreamingResponse: false,
        finalStreamAssistantId: null,
        liveToolEvents: [],
        liveToolOrder: [],
        liveToolPhaseById: {},
        liveReasoningSegments: [],
        liveReasoningBlocks: [],
        liveReasoningPhase: 0,
        persistedLiveReasoningSegments: [],
      };
    case "STREAM_STARTED":
      return {
        ...state,
        isStreamingResponse: true,
        activeStreamEntryKey: action.streamKey,
      };
    case "TOKEN": {
      if (!action.token) {
        return state;
      }
      const hadText = state.liveResponse.trim().length > 0;
      const liveResponse = `${state.liveResponse}${action.token}`;
      const hasText = liveResponse.trim().length > 0;
      return {
        ...state,
        liveResponse,
        liveResponseAnimationKey:
          hasText && !hadText ? state.liveResponseAnimationKey + 1 : state.liveResponseAnimationKey,
      };
    }
    case "REASONING_SET": {
      const segments = action.segments;
      const hadSegments = state.liveReasoningSegments.length > 0;
      const hasSegments = segments.length > 0;
      return {
        ...state,
        liveReasoningSegments: segments,
        persistedLiveReasoningSegments: hasSegments
          ? segments
          : state.persistedLiveReasoningSegments,
        liveReasoningAnimationKey:
          hasSegments && !hadSegments
            ? state.liveReasoningAnimationKey + 1
            : state.liveReasoningAnimationKey,
      };
    }
    case "FINALIZE_REASONING_BLOCK": {
      const nextBlocks = [...state.liveReasoningBlocks];
      nextBlocks[action.phaseIndex] = action.segments;
      return {
        ...state,
        liveReasoningBlocks: nextBlocks,
        liveReasoningSegments: [],
        persistedLiveReasoningSegments: [],
      };
    }
    case "TOOL_CALL": {
      const { toolId, phaseIndex, update } = action;
      return {
        ...state,
        liveToolPhaseById:
          state.liveToolPhaseById[toolId] === phaseIndex
            ? state.liveToolPhaseById
            : { ...state.liveToolPhaseById, [toolId]: phaseIndex },
        liveToolOrder: state.liveToolOrder.includes(toolId)
          ? state.liveToolOrder
          : [...state.liveToolOrder, toolId],
        liveReasoningPhase: phaseIndex + 1,
        liveToolEvents: upsertLiveToolEvents(state.liveToolEvents, update),
      };
    }
    case "TOOL_RESULT": {
      const { toolId, fallbackPhase, update } = action;
      return {
        ...state,
        liveToolOrder: state.liveToolOrder.includes(toolId)
          ? state.liveToolOrder
          : [...state.liveToolOrder, toolId],
        liveToolPhaseById:
          state.liveToolPhaseById[toolId] !== undefined
            ? state.liveToolPhaseById
            : { ...state.liveToolPhaseById, [toolId]: fallbackPhase },
        liveToolEvents: upsertLiveToolEvents(state.liveToolEvents, update),
      };
    }
    case "STREAM_FINISHED": {
      const streamEntryKeyMap =
        action.finalAssistantId && action.streamKey
          ? { ...state.streamEntryKeyMap, [action.finalAssistantId]: action.streamKey }
          : state.streamEntryKeyMap;
      return {
        ...state,
        liveResponse: "",
        isStreamingResponse: false,
        persistedLiveReasoningSegments: action.streamedReasoningSegments,
        liveReasoningSegments: [],
        liveReasoningBlocks: [],
        finalStreamAssistantId: action.finalAssistantId,
        streamEntryKeyMap,
      };
    }
    case "STREAM_FAILED":
      return {
        ...state,
        isStreamingResponse: false,
        liveResponse: action.clearLive ? "" : state.liveResponse,
        liveReasoningSegments: action.clearLive ? [] : state.liveReasoningSegments,
        liveReasoningBlocks: action.clearLive ? [] : state.liveReasoningBlocks,
        liveReasoningPhase: action.clearLive ? 0 : state.liveReasoningPhase,
        persistedLiveReasoningSegments: action.clearLive
          ? []
          : state.persistedLiveReasoningSegments,
      };
    case "STREAM_KEYS_RESET":
      return {
        ...state,
        streamEntryKeyMap: {},
        activeStreamEntryKey: null,
      };
    case "PRUNE_LIVE_TOOLS": {
      if (state.liveToolEvents.length === 0 || action.persistedToolIds.size === 0) {
        return state;
      }
      const next = state.liveToolEvents.filter(
        (event) => !event.id || !action.persistedToolIds.has(event.id),
      );
      return next.length === state.liveToolEvents.length
        ? state
        : { ...state, liveToolEvents: next };
    }
    default:
      return state;
  }
}

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

  const handleReasoning = useCallback(
    (segments: ReasoningTraceSegment[] | null | undefined) => {
      dispatch({ type: "REASONING_SET", segments: segments ?? [] });
    },
    [],
  );

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
