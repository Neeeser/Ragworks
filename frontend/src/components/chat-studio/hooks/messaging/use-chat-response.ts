"use client";

import { useCallback } from "react";

import {
  injectStreamedReasoning,
  type PerformChatMutation,
  type UseChatMutationParams,
} from "@/components/chat-studio/hooks/messaging/chat-mutation-helpers";
import { DEFAULT_STREAMING_ENABLED } from "@/components/chat-studio/lib/chat-constants";
import {
  attachUsageToLastAssistantMessage,
  calculateSessionUsage,
} from "@/components/chat-studio/lib/chat-entry-helpers";
import { areArraysEqual } from "@/components/chat-studio/lib/chat-helpers";
import { createProviderFormFromPreferences } from "@/components/chat-studio/lib/chat-payload-helpers";
import { chat, streamChat } from "@/lib/api";
import { isAbortError } from "@/lib/errors";

import type { ChatCompletionPayload, ChatRequestPayload } from "@/lib/types";

export interface UseChatResponseResult {
  applyChatResponse: (response: ChatCompletionPayload) => void;
  performChatMutation: PerformChatMutation;
}

/**
 * Owns the read side of a chat write: applying a completed response to state and
 * driving a single request (streaming or not) through the live-stream reducer.
 */
export function useChatResponse(params: UseChatMutationParams): UseChatResponseResult {
  const {
    authToken,
    contextWindow,
    setContextWindow,
    toolCollectionsDirtyRef,
    chatStream,
    startProgressPolling,
    stopProgressPolling,
    selectedToolCollectionIds,
    setSelectedToolCollectionIds,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setActiveModelId,
    setParameterOverrides,
    setProviderForm,
    setStreamingEnabled,
    setSessions,
    setStatus,
    setSending,
    setIsStopping,
    navigateToChat,
    pendingSessionIdsRef,
    abortControllerRef,
    syncMessages,
    deriveToolTraces,
    sortSessions,
  } = params;

  const {
    completeStream,
    beginMutation,
    beginStream,
    handleToken,
    handleReasoning,
    handleToolCall,
    handleToolResult,
    failStream,
  } = chatStream;

  const applyChatResponse = useCallback(
    (response: ChatCompletionPayload) => {
      const finalAssistant = [...response.messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const streamedReasoningSegments = completeStream(finalAssistant?.id ?? null);
      const wasPending = pendingSessionIdsRef.current.has(response.session.id);
      pendingSessionIdsRef.current.delete(response.session.id);
      if (wasPending) {
        navigateToChat(response.session.id, selectedToolCollectionIds);
      }

      const messagesToSync = injectStreamedReasoning(
        response.messages,
        finalAssistant,
        streamedReasoningSegments,
      );

      const enrichedMessages = attachUsageToLastAssistantMessage(
        messagesToSync,
        response.usage ?? null,
      );
      // Always hydrate when streaming to prevent delayed message reveals
      syncMessages(enrichedMessages, { hydrate: true });
      const nextToolTraces =
        response.tool_traces && response.tool_traces.length > 0
          ? response.tool_traces
          : deriveToolTraces(response.messages);
      setToolTraces(nextToolTraces);
      setUsage(calculateSessionUsage(enrichedMessages) ?? response.usage ?? null);
      setContextConsumed(response.context_consumed);
      setContextWindow(response.context_window || contextWindow || 0);
      setActiveModelId(response.session.chat_model);
      const resolvedSession =
        toolCollectionsDirtyRef.current && response.session.tool_collection_ids
          ? { ...response.session, tool_collection_ids: selectedToolCollectionIds }
          : response.session;
      if (response.session.tool_collection_ids) {
        setSelectedToolCollectionIds((prev) => {
          if (toolCollectionsDirtyRef.current) {
            return prev;
          }
          return areArraysEqual(prev, response.session.tool_collection_ids)
            ? prev
            : response.session.tool_collection_ids;
        });
      }
      setParameterOverrides(response.session.parameter_overrides ?? {});
      setProviderForm(createProviderFormFromPreferences(response.session.provider_preferences));
      setStreamingEnabled(response.session.stream ?? DEFAULT_STREAMING_ENABLED);
      setSessions((prev) => {
        const next = [...prev];
        const idx = next.findIndex((session) => session.id === response.session.id);
        if (idx >= 0) {
          next[idx] = resolvedSession;
        } else {
          next.push(resolvedSession);
        }
        return sortSessions(next);
      });
    },
    [
      completeStream,
      contextWindow,
      deriveToolTraces,
      navigateToChat,
      pendingSessionIdsRef,
      selectedToolCollectionIds,
      setActiveModelId,
      setContextConsumed,
      setContextWindow,
      setParameterOverrides,
      setProviderForm,
      setSelectedToolCollectionIds,
      setSessions,
      setStreamingEnabled,
      setToolTraces,
      setUsage,
      sortSessions,
      syncMessages,
      toolCollectionsDirtyRef,
    ],
  );

  const performChatMutation = useCallback<PerformChatMutation>(
    async (sessionId, payload, toolCollectionIdsOverride) => {
      if (!authToken) {
        throw new Error("Missing authentication context.");
      }
      const controller = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = controller;
      setIsStopping(false);
      setSending(true);
      setStatus(null);
      toolCollectionsDirtyRef.current = false;
      beginMutation();
      if (!payload.stream) {
        startProgressPolling(sessionId);
      }
      try {
        const requestPayload: ChatRequestPayload = {
          ...payload,
          session_id: sessionId,
          tool_collection_ids: toolCollectionIdsOverride ?? selectedToolCollectionIds,
        };
        let result: ChatCompletionPayload | null;
        if (payload.stream) {
          const streamKey = `stream-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          beginStream(streamKey);
          result = await streamChat(authToken, requestPayload, {
            signal: controller.signal,
            onToken: handleToken,
            onReasoning: handleReasoning,
            onToolCall: handleToolCall,
            onToolResult: handleToolResult,
            onError: (message) => {
              setStatus(message);
            },
          });
        } else {
          result = await chat(authToken, requestPayload, controller.signal);
        }
        if (!result) {
          throw new Error("Streaming response did not complete.");
        }
        applyChatResponse(result);
        return result;
      } catch (error) {
        failStream(!isAbortError(error));
        throw error;
      } finally {
        stopProgressPolling();
        setSending(false);
        setIsStopping(false);
        abortControllerRef.current = null;
      }
    },
    [
      abortControllerRef,
      applyChatResponse,
      authToken,
      beginMutation,
      beginStream,
      failStream,
      handleReasoning,
      handleToken,
      handleToolCall,
      handleToolResult,
      selectedToolCollectionIds,
      setIsStopping,
      setSending,
      setStatus,
      startProgressPolling,
      stopProgressPolling,
      toolCollectionsDirtyRef,
    ],
  );

  return { applyChatResponse, performChatMutation };
}
