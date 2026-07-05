"use client";

import { useCallback } from "react";

import {
  DEFAULT_STREAMING_ENABLED,
  PINECONE_KEY_REQUIRED_MESSAGE,
} from "@/components/chat-studio/chat-constants";
import {
  areArraysEqual,
  attachUsageToLastAssistantMessage,
  calculateSessionUsage,
  createProviderFormFromPreferences,
  ensureMessageOrder,
  generateClientMessageId,
  generateClientSessionId,
  pruneHistoryForEdit,
} from "@/components/chat-studio/chat-helpers";
import { branchChatSession, chat, deleteChatSession, streamChat } from "@/lib/api";

import type { UseChatStreamResult } from "@/components/chat-studio/hooks/use-chat-stream";
import type { ProviderFormState } from "@/components/chat-studio/types";
import type { ParameterOverrides } from "@/lib/chat-parameters";
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  ProviderPreferences,
  ToolCallTrace,
  UsageBreakdown,
} from "@/lib/types";

type Dispatch<T> = React.Dispatch<React.SetStateAction<T>>;

interface NewChatDefaults {
  activeModelId: string | null;
  parameterOverrides: ParameterOverrides;
  providerForm: ProviderFormState;
  streamingEnabled: boolean;
  toolCollectionIds: string[];
}

interface SyncMessagesFn {
  (incoming: ChatMessage[], options?: { hydrate?: boolean; resetStreamKeys?: boolean }): void;
}

export interface UseChatMutationParams {
  // Auth / config
  authToken: string;
  user: { id: string } | null | undefined;
  toolsEnabled: boolean;
  pineconeConfigured: boolean;
  // Run settings
  activeModelId: string | null;
  buildParameterPayload: (
    overrides?: ParameterOverrides,
    modelId?: string,
  ) => ParameterOverrides;
  providerRuleCount: number;
  providerPayload: ProviderPreferences;
  parameterOverrides: ParameterOverrides;
  providerForm: ProviderFormState;
  streamingEnabled: boolean;
  // Routing
  selectedSessionId: string | null;
  navigateToChat: (sessionId: string | null, collectionIds: string[]) => void;
  // Collections
  selectedToolCollectionIds: string[];
  setSelectedToolCollectionIds: Dispatch<string[]>;
  contextWindow: number;
  setContextWindow: Dispatch<number>;
  toolCollectionsDirtyRef: React.MutableRefObject<boolean>;
  // Live-stream hook
  chatStream: UseChatStreamResult;
  // History polling
  startProgressPolling: (sessionId: string) => void;
  stopProgressPolling: () => void;
  // Message / session state
  draft: string;
  setDraft: Dispatch<string>;
  sessions: ChatSession[];
  messages: ChatMessage[];
  sending: boolean;
  editingMessageId: string | null;
  editingDraft: string;
  setSessions: Dispatch<ChatSession[]>;
  setMessages: Dispatch<ChatMessage[]>;
  setToolTraces: Dispatch<ToolCallTrace[]>;
  setUsage: Dispatch<UsageBreakdown | null>;
  setContextConsumed: Dispatch<number>;
  setOptimisticMessages: Dispatch<ChatMessage[]>;
  setActiveModelId: Dispatch<string | null>;
  setParameterOverrides: Dispatch<ParameterOverrides>;
  setProviderForm: Dispatch<ProviderFormState>;
  setStreamingEnabled: Dispatch<boolean>;
  setStatus: Dispatch<string | null>;
  setSending: Dispatch<boolean>;
  setIsStopping: Dispatch<boolean>;
  setEditingMessageId: Dispatch<string | null>;
  setEditingDraft: Dispatch<string>;
  setDeletingSessionId: Dispatch<string | null>;
  // Refs
  pendingSessionIdsRef: React.MutableRefObject<Set<string>>;
  skipHistoryFetchSessionRef: React.MutableRefObject<string | null>;
  branchedSessionOriginRef: React.MutableRefObject<Map<string, "edit" | "manual">>;
  newChatDefaultsRef: React.MutableRefObject<NewChatDefaults | null>;
  applyNewChatDefaultsRef: React.MutableRefObject<boolean>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  messageOrderRef: React.MutableRefObject<Map<string, number>>;
  nextMessageOrderRef: React.MutableRefObject<number>;
  // ChatStudio-owned callbacks
  syncMessages: SyncMessagesFn;
  deriveToolTraces: (items: ChatMessage[]) => ToolCallTrace[];
  sortSessions: (items: ChatSession[]) => ChatSession[];
}

export interface UseChatMutationResult {
  handleSend: () => Promise<void>;
  handleStopGeneration: () => void;
  handleEditSubmit: () => Promise<void>;
  handleRetryAssistant: (messageId: string) => Promise<void>;
  handleBranchMessage: (messageId: string) => Promise<void>;
  handleStartNewChat: () => void;
  handleDeleteSession: (sessionId: string) => Promise<void>;
}

const isAbortError = (value: unknown): value is DOMException =>
  value instanceof DOMException && value.name === "AbortError";

/**
 * Orchestrates every chat write path — send, edit, retry, branch, start-new-chat,
 * delete — on top of the live-stream reducer and the extracted run-settings hooks.
 * Composes their APIs rather than owning state, so ChatStudio stays a thin shell.
 */
export function useChatMutation(params: UseChatMutationParams): UseChatMutationResult {
  const {
    authToken,
    user,
    toolsEnabled,
    pineconeConfigured,
    activeModelId,
    buildParameterPayload,
    providerRuleCount,
    providerPayload,
    parameterOverrides,
    providerForm,
    streamingEnabled,
    selectedSessionId,
    navigateToChat,
    selectedToolCollectionIds,
    setSelectedToolCollectionIds,
    contextWindow,
    setContextWindow,
    toolCollectionsDirtyRef,
    chatStream,
    startProgressPolling,
    stopProgressPolling,
    draft,
    setDraft,
    sessions,
    messages,
    sending,
    editingMessageId,
    editingDraft,
    setSessions,
    setMessages,
    setToolTraces,
    setUsage,
    setContextConsumed,
    setOptimisticMessages,
    setActiveModelId,
    setParameterOverrides,
    setProviderForm,
    setStreamingEnabled,
    setStatus,
    setSending,
    setIsStopping,
    setEditingMessageId,
    setEditingDraft,
    setDeletingSessionId,
    pendingSessionIdsRef,
    skipHistoryFetchSessionRef,
    branchedSessionOriginRef,
    newChatDefaultsRef,
    applyNewChatDefaultsRef,
    abortControllerRef,
    messageOrderRef,
    nextMessageOrderRef,
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
    reset: resetChatStream,
    resetLiveMessage,
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

      // Check if we need to inject persisted reasoning into the final assistant message
      // This handles the case where the tool call response doesn't include the reasoning trace
      // that was just streamed.
      let messagesToSync = response.messages;
      if (finalAssistant && streamedReasoningSegments.length > 0) {
        const hasReasoning =
          finalAssistant.reasoning_trace?.segments &&
          finalAssistant.reasoning_trace.segments.length > 0;
        if (!hasReasoning) {
          messagesToSync = messagesToSync.map((msg) => {
            if (msg.id === finalAssistant.id) {
              return {
                ...msg,
                reasoning_trace: {
                  segments: streamedReasoningSegments,
                },
              };
            }
            return msg;
          });
        }
      }

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

  const performChatMutation = useCallback(
    async (
      sessionId: string,
      payload: Omit<ChatRequestPayload, "session_id">,
      toolCollectionIdsOverride?: string[] | null,
    ) => {
      if (!authToken) {
        throw new Error("Missing authentication context.");
      }
      if (toolsEnabled && !pineconeConfigured) {
        setStatus(PINECONE_KEY_REQUIRED_MESSAGE);
        throw new Error("Pinecone API key is not configured.");
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
      pineconeConfigured,
      selectedToolCollectionIds,
      setIsStopping,
      setSending,
      setStatus,
      startProgressPolling,
      stopProgressPolling,
      toolCollectionsDirtyRef,
      toolsEnabled,
    ],
  );

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
        const statusMessage =
          error instanceof Error ? error.message : "Unable to send your message.";
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
    if (toolsEnabled && !pineconeConfigured) {
      setStatus(PINECONE_KEY_REQUIRED_MESSAGE);
      return;
    }
    const targetModelId = overrides.modelId ?? activeModelId;
    if (!targetModelId) {
      setStatus("Select a chat model before sending a message.");
      return;
    }
    const parameterPayload = buildParameterPayload(overrides.parameterOverrides, overrides.modelId);
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
      setStatus(error instanceof Error ? error.message : "Unable to edit this turn.");
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
      pineconeConfigured,
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
      toolsEnabled,
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
        setStatus(error instanceof Error ? error.message : "Unable to branch this message.");
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

  const handleStartNewChat = useCallback(() => {
    stopProgressPolling();
    newChatDefaultsRef.current = {
      activeModelId,
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
    streamingEnabled,
    toolCollectionsDirtyRef,
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
        setStatus(error instanceof Error ? error.message : "Unable to delete chat session.");
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
