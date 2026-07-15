"use client";

import { useCallback } from "react";

import { useChatEdit } from "@/components/chat-studio/hooks/messaging/use-chat-edit";
import { useChatResponse } from "@/components/chat-studio/hooks/messaging/use-chat-response";
import { useChatSend } from "@/components/chat-studio/hooks/messaging/use-chat-send";
import { deleteChatSession } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type {
  UseChatMutationParams,
  UseChatMutationResult,
} from "@/components/chat-studio/hooks/messaging/chat-mutation-helpers";

export type {
  UseChatMutationParams,
  UseChatMutationResult,
} from "@/components/chat-studio/hooks/messaging/chat-mutation-helpers";

/**
 * Orchestrates every chat write path — send, edit, retry, branch, start-new-chat,
 * delete — by composing the response / send / edit hooks and owning the session-level
 * new-chat + delete actions. Keeps ChatStudio a thin shell over the write graph.
 */
export function useChatMutation(params: UseChatMutationParams): UseChatMutationResult {
  const {
    authToken,
    activeModelId,
    activeConnectionId,
    parameterOverrides,
    providerForm,
    streamingEnabled,
    selectedSessionId,
    navigateToChat,
    selectedToolCollectionIds,
    toolCollectionsDirtyRef,
    chatStream,
    stopProgressPolling,
    sessions,
    setSessions,
    setMessages,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setOptimisticMessages,
    setDraft,
    setStatus,
    setEditingMessageId,
    setEditingDraft,
    setDeletingSessionId,
    pendingSessionIdsRef,
    newChatDefaultsRef,
    applyNewChatDefaultsRef,
  } = params;

  const { reset: resetChatStream } = chatStream;

  const { performChatMutation } = useChatResponse(params);
  const { handleSend, handleStopGeneration } = useChatSend({ ...params, performChatMutation });
  const { handleEditSubmit, handleRetryAssistant, handleBranchMessage } = useChatEdit({
    ...params,
    performChatMutation,
  });

  const handleStartNewChat = useCallback(() => {
    stopProgressPolling();
    newChatDefaultsRef.current = {
      activeModelId,
      activeConnectionId,
      parameterOverrides,
      providerForm,
      streamingEnabled,
      toolCollectionIds: selectedToolCollectionIds,
    };
    applyNewChatDefaultsRef.current = true;
    pendingSessionIdsRef.current.clear();
    toolCollectionsDirtyRef.current = false;
    setMessages([]);
    setToolTraces([]);
    resetChatStream();
    setUsage(null);
    setContextConsumed(0);
    setDraft("");
    setEditingMessageId(null);
    setEditingDraft("");
    setOptimisticMessages([]);
    navigateToChat(null, selectedToolCollectionIds);
  }, [
    activeModelId,
    activeConnectionId,
    applyNewChatDefaultsRef,
    navigateToChat,
    newChatDefaultsRef,
    parameterOverrides,
    pendingSessionIdsRef,
    providerForm,
    resetChatStream,
    selectedToolCollectionIds,
    setContextConsumed,
    setDraft,
    setEditingDraft,
    setEditingMessageId,
    setMessages,
    setOptimisticMessages,
    setToolTraces,
    setUsage,
    stopProgressPolling,
    toolCollectionsDirtyRef,
    streamingEnabled,
  ]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!authToken) return;
      setStatus(null);
      setDeletingSessionId(sessionId);
      try {
        await deleteChatSession(authToken, sessionId);
        let nextSelectedId: string | null = null;
        setSessions((prev) => {
          const next = prev.filter((session) => session.id !== sessionId);
          if (selectedSessionId === sessionId) {
            nextSelectedId = next[0]?.id ?? null;
          }
          return next;
        });
        if (selectedSessionId === sessionId) {
          if (nextSelectedId) {
            const nextSession = sessions.find((session) => session.id === nextSelectedId);
            navigateToChat(nextSelectedId, nextSession?.tool_collection_ids ?? []);
          } else {
            handleStartNewChat();
          }
        }
      } catch (error) {
        setStatus(getErrorMessage(error, "Unable to delete chat session."));
      } finally {
        setDeletingSessionId((current) => (current === sessionId ? null : current));
      }
    },
    [
      authToken,
      handleStartNewChat,
      navigateToChat,
      selectedSessionId,
      sessions,
      setDeletingSessionId,
      setSessions,
      setStatus,
    ],
  );

  return {
    handleSend,
    handleStopGeneration,
    handleEditSubmit,
    handleRetryAssistant,
    handleBranchMessage,
    handleStartNewChat,
    handleDeleteSession,
  };
}
