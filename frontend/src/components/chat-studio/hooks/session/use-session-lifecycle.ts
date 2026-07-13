"use client";

import { useEffect, useMemo } from "react";

import { DEFAULT_STREAMING_ENABLED } from "@/components/chat-studio/lib/chat-constants";
import {
  createDefaultProviderForm,
  createProviderFormFromPreferences,
} from "@/components/chat-studio/lib/chat-payload-helpers";
import { listChatSessions } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ChatStudioCoreState } from "@/components/chat-studio/hooks/use-chat-studio-state";
import type { ProviderFormState } from "@/components/chat-studio/lib/types";
import type { ParameterOverrides } from "@/lib/chat-parameters";
import type { ChatSession, User } from "@/lib/types";

export interface UseSessionLifecycleParams extends ChatStudioCoreState {
  authLoading: boolean;
  connectionsLoading: boolean;
  authToken: string;
  chatProviderConfigured: boolean;
  user: User | null;
  selectedSessionId: string | null;
  sessionIdParam: string | null;
  isPendingSession: boolean;
  replaceUrl: (url: string) => void;
  buildChatUrl: (sessionId: string | null, collectionIds: string[]) => string;
  selectedToolCollectionIds: string[];
  historyFilterActive: boolean;
  historyFilterCollectionIds: string[];
  historyFilterIncludeUnassigned: boolean;
  resolveValidToolCollectionIds: (ids: string[]) => string[];
  setSelectedToolCollectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setParameterOverrides: React.Dispatch<React.SetStateAction<ParameterOverrides>>;
  setProviderForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  sortSessions: (items: ChatSession[]) => ChatSession[];
}

export interface UseSessionLifecycleResult {
  activeSession: ChatSession | null;
  branchedFromSession: ChatSession | null;
}

/**
 * Owns the session-configuration lifecycle: status gating, session-list load, applying
 * a selected or new session's run defaults (model / parameters / provider / streaming /
 * tools), and the URL <-> session reconciliation. Returns the active + branched-from
 * session memos the timeline renders.
 */
export function useSessionLifecycle(params: UseSessionLifecycleParams): UseSessionLifecycleResult {
  const {
    authLoading,
    connectionsLoading,
    authToken,
    chatProviderConfigured,
    user,
    selectedSessionId,
    sessionIdParam,
    isPendingSession,
    replaceUrl,
    buildChatUrl,
    selectedToolCollectionIds,
    historyFilterActive,
    historyFilterCollectionIds,
    historyFilterIncludeUnassigned,
    resolveValidToolCollectionIds,
    setSelectedToolCollectionIds,
    setParameterOverrides,
    setProviderForm,
    sortSessions,
    sessions,
    setSessions,
    setStatus,
    loading,
    setLoading,
    activeModelId,
    setActiveModelId,
    setActiveConnectionId,
    setStreamingEnabled,
    previousModelIdRef,
    applyNewChatDefaultsRef,
    newChatDefaultsRef,
    pendingSessionIdsRef,
  } = params;

  // Keep the URL in sync with the selected session once it is no longer pending.
  useEffect(() => {
    if (isPendingSession) {
      return;
    }
    if (sessionIdParam !== selectedSessionId) {
      return;
    }
    replaceUrl(buildChatUrl(selectedSessionId, selectedToolCollectionIds));
  }, [
    buildChatUrl,
    replaceUrl,
    isPendingSession,
    selectedSessionId,
    sessionIdParam,
    selectedToolCollectionIds,
  ]);

  useEffect(() => {
    if (authLoading || connectionsLoading) {
      return;
    }
    if (!authToken) {
      setLoading(false);
      setStatus("Sign in to access the chat studio.");
      return;
    }
    if (!chatProviderConfigured) {
      setStatus("No chat provider is configured. Add one in Settings to continue.");
      return;
    }
    setStatus(null);
  }, [authLoading, authToken, chatProviderConfigured, connectionsLoading, setLoading, setStatus]);

  useEffect(() => {
    if (authLoading) {
      // Still resolving auth — keep the loader up rather than flashing an
      // empty state.
      return;
    }
    if (!authToken) {
      setSessions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setStatus(null);
    const options = historyFilterActive
      ? {
          collectionIds: historyFilterCollectionIds,
          includeUnassigned: historyFilterIncludeUnassigned,
        }
      : undefined;
    listChatSessions(authToken, options)
      .then((sessionList) => {
        if (cancelled) return;
        setSessions(sortSessions(sessionList));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(getErrorMessage(error, "Unable to load chat sessions."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("chatStudio.loaded", "true");
          }
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authLoading,
    authToken,
    historyFilterActive,
    historyFilterCollectionIds,
    historyFilterIncludeUnassigned,
    chatProviderConfigured,
    sessionIdParam,
    sortSessions,
  ]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (session?.chat_model) {
      setActiveModelId((current) =>
        current === session.chat_model ? current : session.chat_model,
      );
    }
    if (session) {
      // Always sync — a legacy session without a connection must clear the
      // previous session's id, or its sends route through the wrong provider.
      const nextConnection = session.provider_connection_id ?? null;
      setActiveConnectionId((current) => (current === nextConnection ? current : nextConnection));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!activeModelId) {
      previousModelIdRef.current = null;
      return;
    }
    const previous = previousModelIdRef.current;
    if (previous && previous !== activeModelId) {
      setParameterOverrides({});
      setProviderForm(createDefaultProviderForm());
    }
    previousModelIdRef.current = activeModelId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    if (pendingSessionIdsRef.current.has(selectedSessionId)) {
      return;
    }
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (!session) {
      return;
    }
    setSelectedToolCollectionIds(session.tool_collection_ids ?? []);
    setParameterOverrides(session.parameter_overrides ?? {});
    setProviderForm(createProviderFormFromPreferences(session.provider_preferences));
    setStreamingEnabled(session.stream ?? DEFAULT_STREAMING_ENABLED);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      applyNewChatDefaultsRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  useEffect(() => {
    if (loading || selectedSessionId || !applyNewChatDefaultsRef.current) {
      return;
    }
    if (newChatDefaultsRef.current) {
      const snapshot = newChatDefaultsRef.current;
      setActiveModelId(snapshot.activeModelId);
      setActiveConnectionId(snapshot.activeConnectionId);
      setParameterOverrides(snapshot.parameterOverrides);
      setProviderForm(snapshot.providerForm);
      setStreamingEnabled(snapshot.streamingEnabled);
      setSelectedToolCollectionIds(snapshot.toolCollectionIds);
      newChatDefaultsRef.current = null;
      applyNewChatDefaultsRef.current = false;
      return;
    }
    const pendingIds = pendingSessionIdsRef.current;
    const latestSession = sessions.find((session) => !pendingIds.has(session.id)) ?? null;
    if (latestSession) {
      setActiveModelId(latestSession.chat_model);
      setActiveConnectionId(latestSession.provider_connection_id ?? null);
      setParameterOverrides(latestSession.parameter_overrides ?? {});
      setProviderForm(createProviderFormFromPreferences(latestSession.provider_preferences));
      setStreamingEnabled(latestSession.stream ?? DEFAULT_STREAMING_ENABLED);
      setSelectedToolCollectionIds(latestSession.tool_collection_ids ?? []);
    } else if (user) {
      setActiveModelId(user.last_used_chat_model ?? null);
      setActiveConnectionId(user.last_used_chat_connection_id ?? null);
      setParameterOverrides(user.last_used_parameters ?? {});
      setProviderForm(createProviderFormFromPreferences(user.last_used_provider));
      setStreamingEnabled(user.last_used_stream ?? DEFAULT_STREAMING_ENABLED);
      setSelectedToolCollectionIds(
        resolveValidToolCollectionIds(user.last_used_tool_collection_ids ?? []),
      );
    }
    applyNewChatDefaultsRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, resolveValidToolCollectionIds, selectedSessionId, sessions, user]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const branchedFromSession = useMemo(() => {
    if (!activeSession?.branched_from_session_id) {
      return null;
    }
    return (
      sessions.find((session) => session.id === activeSession.branched_from_session_id) ?? null
    );
  }, [activeSession, sessions]);

  return { activeSession, branchedFromSession };
}
