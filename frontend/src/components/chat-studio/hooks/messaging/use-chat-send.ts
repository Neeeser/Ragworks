"use client";

import { useCallback } from "react";

import {
  type PerformChatMutation,
  type UseChatMutationParams,
} from "@/components/chat-studio/hooks/messaging/chat-mutation-helpers";
import { PINECONE_KEY_REQUIRED_MESSAGE } from "@/components/chat-studio/lib/chat-constants";
import { ensureMessageOrder } from "@/components/chat-studio/lib/chat-entry-helpers";
import {
  generateClientMessageId,
  generateClientSessionId,
} from "@/components/chat-studio/lib/chat-helpers";
import { getErrorMessage, isAbortError } from "@/lib/errors";

import type { ChatMessage, ChatSession } from "@/lib/types";

export interface UseChatSendParams extends UseChatMutationParams {
  performChatMutation: PerformChatMutation;
}

export interface UseChatSendResult {
  handleSend: () => Promise<void>;
  handleStopGeneration: () => void;
}

/** Owns the primary send path plus stop-generation. */
export function useChatSend(params: UseChatSendParams): UseChatSendResult {
  const {
    authToken,
    user,
    toolsEnabled,
    pineconeConfigured,
    activeModelId,
    buildParameterPayload,
    providerRuleCount,
    providerPayload,
    streamingEnabled,
    selectedSessionId,
    navigateToChat,
    selectedToolCollectionIds,
    performChatMutation,
    stopProgressPolling,
    draft,
    setDraft,
    sending,
    setSessions,
    setMessages,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setOptimisticMessages,
    setStatus,
    setIsStopping,
    pendingSessionIdsRef,
    abortControllerRef,
    messageOrderRef,
    nextMessageOrderRef,
    sortSessions,
  } = params;

  const { resetLiveMessage } = params.chatStream;

  const handleSend = useCallback(async () => {
    if (!authToken || !user) return;
    if (toolsEnabled && !pineconeConfigured) {
      setStatus(PINECONE_KEY_REQUIRED_MESSAGE);
      return;
    }
    const targetModelId = activeModelId;
    if (!targetModelId) {
      setStatus("Select a chat model before sending a message.");
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    const parameterPayload = buildParameterPayload();
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = providerRuleCount > 0 ? providerPayload : undefined;
    let sessionId = selectedSessionId;
    const isNewSession = !sessionId;
    if (!sessionId) {
      sessionId = generateClientSessionId();
      const placeholderSession: ChatSession = {
        id: sessionId,
        user_id: user.id,
        title: `Chat ${new Date().toLocaleTimeString()}`,
        mode: "chat",
        chat_model: targetModelId,
        context_tokens: 0,
        tool_collection_ids: selectedToolCollectionIds,
        parameter_overrides: parameters ?? {},
        provider_preferences: provider ?? {},
        stream: streamingEnabled,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSessions((prev) => sortSessions([...prev, placeholderSession]));
      pendingSessionIdsRef.current.add(sessionId);
      setMessages([]);
      setToolTraces([]);
      setUsage(null);
      setContextConsumed(0);
      setOptimisticMessages([]);
      navigateToChat(sessionId, selectedToolCollectionIds);
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });
    }
    if (!sessionId) return;

    setDraft("");
    const placeholderMessageId = generateClientMessageId();
    const placeholderMessage: ChatMessage = {
      id: placeholderMessageId,
      session_id: sessionId,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    ensureMessageOrder(messageOrderRef.current, nextMessageOrderRef, [placeholderMessage]);
    setOptimisticMessages((prev) => [...prev, placeholderMessage]);

    resetLiveMessage();
    try {
      await performChatMutation(sessionId, {
        content: trimmed,
        mode: "chat",
        title: isNewSession ? `Chat ${new Date().toLocaleTimeString()}` : undefined,
        chat_model: targetModelId,
        parameters,
        provider,
        stream: streamingEnabled,
      });
    } catch (error) {
      const aborted = isAbortError(error);
      if (sessionId) {
        pendingSessionIdsRef.current.delete(sessionId);
      }
      if (!aborted) {
        setDraft(trimmed);
      }
      if (isNewSession && sessionId && !aborted) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        navigateToChat(null, selectedToolCollectionIds);
      }
      if (!aborted) {
        const statusMessage = getErrorMessage(error, "Unable to send your message.");
        setStatus(statusMessage);
      }
    } finally {
      setOptimisticMessages((prev) =>
        prev.filter((message) => message.id !== placeholderMessageId),
      );
    }
  }, [
    activeModelId,
    authToken,
    buildParameterPayload,
    draft,
    messageOrderRef,
    navigateToChat,
    nextMessageOrderRef,
    pendingSessionIdsRef,
    performChatMutation,
    pineconeConfigured,
    providerPayload,
    providerRuleCount,
    resetLiveMessage,
    selectedSessionId,
    selectedToolCollectionIds,
    setContextConsumed,
    setDraft,
    setMessages,
    setOptimisticMessages,
    setSessions,
    setStatus,
    setToolTraces,
    setUsage,
    sortSessions,
    streamingEnabled,
    toolsEnabled,
    user,
  ]);

  const handleStopGeneration = useCallback(() => {
    if (!sending) {
      return;
    }
    setIsStopping(true);
    abortControllerRef.current?.abort();
    stopProgressPolling();
  }, [abortControllerRef, sending, setIsStopping, stopProgressPolling]);

  return { handleSend, handleStopGeneration };
}
