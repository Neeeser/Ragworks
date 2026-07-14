"use client";

import { useCallback } from "react";

import {
  type PerformChatMutation,
  type UseChatMutationParams,
} from "@/components/chat-studio/hooks/messaging/chat-mutation-helpers";
import { DEFAULT_STREAMING_ENABLED } from "@/components/chat-studio/lib/chat-constants";
import {
  calculateSessionUsage,
  pruneHistoryForEdit,
} from "@/components/chat-studio/lib/chat-entry-helpers";
import { createProviderFormFromPreferences } from "@/components/chat-studio/lib/chat-payload-helpers";
import { branchChatSession } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ParameterOverrides } from "@/lib/chat-parameters";
import type { ChatMessage, ProviderPreferences } from "@/lib/types";

export interface UseChatEditParams extends UseChatMutationParams {
  performChatMutation: PerformChatMutation;
}

export interface UseChatEditResult {
  handleEditSubmit: () => Promise<void>;
  handleRetryAssistant: (messageId: string) => Promise<void>;
  handleBranchMessage: (messageId: string) => Promise<void>;
}

/** Owns the edit / retry / branch write paths, including the branch-for-edit setup. */
export function useChatEdit(params: UseChatEditParams): UseChatEditResult {
  const {
    authToken,
    activeModelId,
    buildParameterPayload,
    providerRuleCount,
    providerPayload,
    streamingEnabled,
    selectedSessionId,
    navigateToChat,
    setSelectedToolCollectionIds,
    toolCollectionsDirtyRef,
    performChatMutation,
    messages,
    editingMessageId,
    editingDraft,
    setSessions,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setOptimisticMessages,
    setActiveModelId,
    setActiveConnectionId,
    setParameterOverrides,
    setProviderForm,
    setStreamingEnabled,
    setStatus,
    setEditingMessageId,
    setEditingDraft,
    skipHistoryFetchSessionRef,
    branchedSessionOriginRef,
    syncMessages,
    deriveToolTraces,
    sortSessions,
  } = params;

  const { reset: resetChatStream } = params.chatStream;

  const runEditMutation = useCallback(
    async (
      messageId: string,
      newContent: string,
      overrides: {
        sessionId?: string;
        modelId?: string;
        toolCollectionIds?: string[];
        messages?: ChatMessage[];
        parameterOverrides?: ParameterOverrides;
        provider?: ProviderPreferences;
        stream?: boolean;
      } = {},
    ) => {
      const sessionId = overrides.sessionId ?? selectedSessionId;
      if (!authToken || !sessionId) return;
      const targetModelId = overrides.modelId ?? activeModelId;
      if (!targetModelId) {
        setStatus("Select a chat model before sending a message.");
        return;
      }
      const parameterPayload = buildParameterPayload(
        overrides.parameterOverrides,
        overrides.modelId,
      );
      const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
      const provider = overrides.provider ?? (providerRuleCount > 0 ? providerPayload : undefined);
      const baseMessages = overrides.messages ?? messages;
      const prunedMessages = pruneHistoryForEdit(baseMessages, messageId, newContent);
      if (prunedMessages !== baseMessages) {
        syncMessages(prunedMessages, { hydrate: true });
        setToolTraces(deriveToolTraces(prunedMessages));
        setUsage(calculateSessionUsage(prunedMessages));
      }
      try {
        await performChatMutation(
          sessionId,
          {
            content: newContent,
            edit_message_id: messageId,
            mode: "chat",
            chat_model: targetModelId,
            parameters,
            provider,
            stream: overrides.stream ?? streamingEnabled,
          },
          overrides.toolCollectionIds,
        );
        setEditingMessageId(null);
        setEditingDraft("");
      } catch (error) {
        setStatus(getErrorMessage(error, "Unable to edit this turn."));
      } finally {
        if (skipHistoryFetchSessionRef.current === sessionId) {
          skipHistoryFetchSessionRef.current = null;
        }
      }
    },
    [
      activeModelId,
      authToken,
      buildParameterPayload,
      deriveToolTraces,
      messages,
      performChatMutation,
      providerPayload,
      providerRuleCount,
      selectedSessionId,
      setEditingDraft,
      setEditingMessageId,
      setStatus,
      setToolTraces,
      setUsage,
      skipHistoryFetchSessionRef,
      streamingEnabled,
      syncMessages,
    ],
  );

  const branchSessionForEdit = useCallback(
    async (messageId: string, origin: "edit" | "manual") => {
      if (!authToken || !selectedSessionId) {
        return null;
      }
      try {
        const response = await branchChatSession(authToken, selectedSessionId, {
          message_id: messageId,
        });
        const branchedSession = response.session;
        const branchedMessages = response.messages;
        setSessions((prev) => {
          const next = prev.filter((session) => session.id !== branchedSession.id);
          next.push(branchedSession);
          return sortSessions(next);
        });
        setActiveModelId(branchedSession.chat_model);
        setActiveConnectionId(branchedSession.provider_connection_id ?? null);
        setSelectedToolCollectionIds(branchedSession.tool_collection_ids ?? []);
        setParameterOverrides(branchedSession.parameter_overrides ?? {});
        setProviderForm(createProviderFormFromPreferences(branchedSession.provider_preferences));
        setStreamingEnabled(branchedSession.stream ?? DEFAULT_STREAMING_ENABLED);
        setUsage(calculateSessionUsage(branchedMessages));
        setContextConsumed(branchedSession.context_tokens ?? 0);
        setToolTraces(deriveToolTraces(branchedMessages));
        resetChatStream();
        setEditingMessageId(null);
        setEditingDraft("");
        setOptimisticMessages([]);
        toolCollectionsDirtyRef.current = false;
        branchedSessionOriginRef.current.set(branchedSession.id, origin);
        if (origin === "edit") {
          skipHistoryFetchSessionRef.current = branchedSession.id;
        }
        syncMessages(branchedMessages, { hydrate: true, resetStreamKeys: true });
        navigateToChat(branchedSession.id, branchedSession.tool_collection_ids ?? []);
        return { session: branchedSession, messages: branchedMessages };
      } catch (error) {
        setStatus(getErrorMessage(error, "Unable to branch this message."));
        return null;
      }
    },
    [
      authToken,
      branchedSessionOriginRef,
      deriveToolTraces,
      navigateToChat,
      resetChatStream,
      selectedSessionId,
      setActiveModelId,
      setActiveConnectionId,
      setContextConsumed,
      setEditingDraft,
      setEditingMessageId,
      setOptimisticMessages,
      setParameterOverrides,
      setProviderForm,
      setSelectedToolCollectionIds,
      setSessions,
      setStatus,
      setStreamingEnabled,
      setToolTraces,
      setUsage,
      skipHistoryFetchSessionRef,
      sortSessions,
      syncMessages,
      toolCollectionsDirtyRef,
    ],
  );

  const handleEditSubmit = useCallback(async () => {
    if (!editingMessageId) return;
    const trimmed = editingDraft.trim();
    if (!trimmed) {
      setStatus("Edited message cannot be empty.");
      return;
    }
    const branched = await branchSessionForEdit(editingMessageId, "edit");
    if (!branched) {
      return;
    }
    const targetMessage =
      branched.messages.find(
        (message) => message.source_message_id === editingMessageId && message.role === "user",
      ) ??
      branched.messages.find((message) => message.source_message_id === editingMessageId) ??
      branched.messages.find((message) => message.id === editingMessageId) ??
      null;
    if (!targetMessage) {
      setStatus("Unable to locate the branched message to edit.");
      return;
    }
    await runEditMutation(targetMessage.id, trimmed, {
      sessionId: branched.session.id,
      modelId: branched.session.chat_model,
      toolCollectionIds: branched.session.tool_collection_ids ?? [],
      messages: branched.messages,
      parameterOverrides: branched.session.parameter_overrides ?? {},
      provider: branched.session.provider_preferences ?? undefined,
      stream: branched.session.stream ?? DEFAULT_STREAMING_ENABLED,
    });
  }, [branchSessionForEdit, editingDraft, editingMessageId, runEditMutation, setStatus]);

  const handleRetryAssistant = useCallback(
    async (messageId: string) => {
      await runEditMutation(messageId, "");
    },
    [runEditMutation],
  );

  const handleBranchMessage = useCallback(
    async (messageId: string) => {
      await branchSessionForEdit(messageId, "manual");
    },
    [branchSessionForEdit],
  );

  return { handleEditSubmit, handleRetryAssistant, handleBranchMessage };
}
