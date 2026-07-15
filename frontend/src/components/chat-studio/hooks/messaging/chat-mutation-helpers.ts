import type { UseChatStreamResult } from "@/components/chat-studio/hooks/messaging/use-chat-stream";
import type { ProviderFormState } from "@/components/chat-studio/lib/types";
import type { ParameterOverrides } from "@/lib/chat-parameters";
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from "@/lib/types";

export type Dispatch<T> = React.Dispatch<React.SetStateAction<T>>;

export interface NewChatDefaults {
  activeModelId: string | null;
  activeConnectionId: string | null;
  parameterOverrides: ParameterOverrides;
  providerForm: ProviderFormState;
  streamingEnabled: boolean;
  toolCollectionIds: string[];
}

export interface SyncMessagesFn {
  (incoming: ChatMessage[], options?: { hydrate?: boolean; resetStreamKeys?: boolean }): void;
}

/** Runs a chat request against a session and applies the response; throws on failure. */
export type PerformChatMutation = (
  sessionId: string,
  payload: Omit<ChatRequestPayload, "session_id">,
  toolCollectionIdsOverride?: string[] | null,
) => Promise<ChatCompletionPayload>;

/** Shared dependency bag threaded from ChatStudio into every chat write-path hook. */
export interface UseChatMutationParams {
  // Auth / config
  authToken: string;
  user: { id: string } | null | undefined;
  toolsEnabled: boolean;
  // Run settings
  activeModelId: string | null;
  activeConnectionId: string | null;
  buildParameterPayload: (overrides?: ParameterOverrides, modelId?: string) => ParameterOverrides;
  providerRuleCount: number;
  providerPayload: import("@/lib/types").ProviderPreferences;
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
  setActiveConnectionId: Dispatch<string | null>;
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

/**
 * Injects freshly-streamed reasoning segments into the final assistant message when the
 * persisted response omitted them (tool-call turns can drop the just-streamed trace).
 * Pure: returns the original array when no injection is needed.
 */
export function injectStreamedReasoning(
  messages: ChatMessage[],
  finalAssistant: ChatMessage | undefined,
  streamedReasoningSegments: ReasoningTraceSegment[],
): ChatMessage[] {
  if (!finalAssistant || streamedReasoningSegments.length === 0) {
    return messages;
  }
  const hasReasoning =
    finalAssistant.reasoning_trace?.segments && finalAssistant.reasoning_trace.segments.length > 0;
  if (hasReasoning) {
    return messages;
  }
  return messages.map((msg) =>
    msg.id === finalAssistant.id
      ? { ...msg, reasoning_trace: { segments: streamedReasoningSegments } }
      : msg,
  );
}
