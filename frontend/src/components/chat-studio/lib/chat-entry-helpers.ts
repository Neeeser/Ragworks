"use client";

import { coerceRecord, normalizeReasoningSegments, safeParseJSON } from "./chat-utils";

import type { ChatEntry } from "./chat-types";
import type {
  ChatMessage,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from "@/lib/types";

const OPTIMISTIC_CLOCK_SKEW_MS = 5_000;

interface BuildChatEntriesParams {
  messages: ChatMessage[];
  optimisticMessages: ChatMessage[];
  messageOrder: Map<string, number>;
  toolTraceMap: Map<string, ToolCallTrace>;
  getPersistedReasoningSegments: (
    messageId: string,
    segments: ReasoningTraceSegment[],
  ) => ReasoningTraceSegment[];
  formatToolLabel: (label: string) => string;
}

export const isToolReasoningSegment = (segment: ReasoningTraceSegment): boolean => {
  const typeValue = typeof segment.type === "string" ? segment.type.toLowerCase() : "";
  if (
    typeValue === "tool_call" ||
    typeValue === "tool_use" ||
    typeValue === "tool_request" ||
    typeValue === "call_tool" ||
    typeValue === "function_call"
  ) {
    return true;
  }
  return Boolean(segment.call || segment.function || segment.tool_call_id || segment.tool_name);
};

export const isOptimisticDuplicate = (
  optimistic: ChatMessage,
  message: ChatMessage,
  messageOrder: Map<string, number>,
): boolean => {
  if (message.session_id !== optimistic.session_id) {
    return false;
  }
  if (message.role !== "user") {
    return false;
  }
  if (message.content.trim() !== optimistic.content.trim()) {
    return false;
  }
  const optimisticOrder = messageOrder.get(optimistic.id);
  const persistedOrder = messageOrder.get(message.id);
  if (optimisticOrder !== undefined && persistedOrder !== undefined) {
    return persistedOrder >= optimisticOrder;
  }
  const optimisticTimestamp = Date.parse(optimistic.created_at);
  const persistedTimestamp = Date.parse(message.created_at);
  if (!Number.isNaN(optimisticTimestamp) && !Number.isNaN(persistedTimestamp)) {
    return Math.abs(persistedTimestamp - optimisticTimestamp) <= OPTIMISTIC_CLOCK_SKEW_MS;
  }
  return true;
};

/** Pure projection of persisted + optimistic chat messages into the ordered list of
 * timeline entries (message bubbles, reasoning blocks, tool calls). */
export const buildChatEntries = ({
  messages,
  optimisticMessages,
  messageOrder,
  toolTraceMap,
  getPersistedReasoningSegments,
  formatToolLabel,
}: BuildChatEntriesParams): ChatEntry[] => {
  const dedupedOptimistic = optimisticMessages.filter((optimistic) => {
    const trimmedOptimistic = optimistic.content.trim();
    if (!trimmedOptimistic) {
      return false;
    }
    return !messages.some((message) => isOptimisticDuplicate(optimistic, message, messageOrder));
  });
  const combined = [...messages, ...dedupedOptimistic].sort((a, b) => {
    const aOrder = messageOrder.get(a.id);
    const bOrder = messageOrder.get(b.id);
    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }
    if (aOrder !== undefined) {
      return -1;
    }
    if (bOrder !== undefined) {
      return 1;
    }
    const aTime = Date.parse(a.created_at) || 0;
    const bTime = Date.parse(b.created_at) || 0;
    if (aTime === bTime) {
      return a.id.localeCompare(b.id);
    }
    return aTime - bTime;
  });

  return combined.flatMap((message) => {
    const entryList: ChatEntry[] = [];
    const createdAt = message.created_at;
    const trimmedContent = message.content?.trim() ?? "";
    const isAssistant = message.role === "assistant";
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const isError = message.role === "error";
    const isTool = message.role === "tool";
    const isToolCallPlaceholder =
      isAssistant &&
      !trimmedContent &&
      Array.isArray(message.tool_payload?.tool_calls) &&
      message.tool_payload?.tool_calls.length > 0;

    if (isAssistant) {
      const reasoningSegments = getPersistedReasoningSegments(
        `${message.id}-assistant-reasoning`,
        normalizeReasoningSegments(message.reasoning_trace),
      );
      const assistantSegments = reasoningSegments.filter(
        (segment) => !isToolReasoningSegment(segment),
      );
      if (assistantSegments.length > 0) {
        entryList.push({
          id: `${message.id}:reasoning:assistant`,
          type: "reasoning",
          messageId: message.id,
          source: "assistant",
          title: "Reasoning",
          subtitle: "Assistant reasoning",
          segments: assistantSegments,
          createdAt,
        });
      }
    }

    if (isTool) {
      const trace = message.tool_call_id ? toolTraceMap.get(message.tool_call_id) : null;
      const toolSegments = getPersistedReasoningSegments(
        `${message.id}-tool-reasoning`,
        trace
          ? normalizeReasoningSegments(trace.reasoning)
          : normalizeReasoningSegments(message.reasoning_trace),
      );
      const rawPayload =
        (message.tool_payload as Record<string, unknown> | null) ??
        safeParseJSON(message.content) ??
        {};
      const payloadRecord: Record<string, unknown> = {
        ...coerceRecord(rawPayload),
        ...(trace
          ? {
              arguments: trace.arguments,
              response: trace.response,
            }
          : {}),
      };
      const collectionName =
        trace?.collection_name ||
        (typeof payloadRecord.collection_name === "string" ? payloadRecord.collection_name : null);
      const baseToolLabel = formatToolLabel(trace?.name || message.tool_name || "Tool");
      const toolLabel = collectionName ? `${baseToolLabel} · ${collectionName}` : baseToolLabel;
      if (toolSegments.length > 0) {
        entryList.push({
          id: `${message.id}:reasoning:tool`,
          type: "reasoning",
          messageId: message.id,
          source: "tool",
          title: "Reasoning",
          subtitle: toolLabel,
          segments: toolSegments,
          relatedToolLabel: toolLabel,
          createdAt,
        });
      }
      const argsRecord = coerceRecord(payloadRecord.arguments ?? {});
      const responseRecord = coerceRecord(payloadRecord.response ?? payloadRecord);
      entryList.push({
        id: `${message.id}:tool`,
        type: "tool-call",
        message,
        messageId: message.id,
        label: toolLabel,
        args: argsRecord,
        response: responseRecord,
        rawPayload: payloadRecord,
        createdAt,
      });
      return entryList;
    }

    if (!isToolCallPlaceholder && (isUser || isAssistant || isSystem || isError)) {
      entryList.push({
        id: message.id,
        type: isAssistant ? "assistant" : isUser ? "user" : isError ? "error" : "system",
        message,
        messageId: message.id,
        content: trimmedContent || "No response captured.",
        createdAt,
      });
    }

    return entryList;
  });
};

export const deriveToolTracesFromMessages = (items: ChatMessage[]): ToolCallTrace[] =>
  items
    .filter((message) => message.role === "tool")
    .map((message) => {
      const payload =
        (message.tool_payload as Record<string, unknown> | null) ??
        safeParseJSON(message.content) ??
        {};
      const payloadRecord = coerceRecord(payload);
      const argsValue = payloadRecord.arguments ?? {};
      const responseValue = payloadRecord.response ?? payloadRecord;
      const reasoningSegments = normalizeReasoningSegments(message.reasoning_trace);
      return {
        id: message.tool_call_id || message.id,
        name: message.tool_name || "tool_call",
        arguments: coerceRecord(argsValue),
        response: coerceRecord(responseValue),
        reasoning: reasoningSegments.length > 0 ? { segments: reasoningSegments } : null,
      } satisfies ToolCallTrace;
    });

export const calculateSessionUsage = (items: ChatMessage[]): UsageBreakdown | null => {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalReasoningTokens = 0;
  let totalCost = 0;
  let hasUsage = false;

  for (const message of items) {
    if (message.usage) {
      hasUsage = true;
      if (message.usage.prompt_tokens != null) {
        totalPromptTokens += message.usage.prompt_tokens;
      }
      if (message.usage.completion_tokens != null) {
        totalCompletionTokens += message.usage.completion_tokens;
      }
      if (message.usage.total_tokens != null) {
        totalTokens += message.usage.total_tokens;
      }
      if (message.usage.reasoning_tokens != null) {
        totalReasoningTokens += message.usage.reasoning_tokens;
      }
      if (message.usage.cost != null) {
        totalCost += message.usage.cost;
      }
    }
  }

  if (!hasUsage) {
    return null;
  }

  return {
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    total_tokens: totalTokens,
    reasoning_tokens: totalReasoningTokens,
    cost: totalCost,
  };
};

export const attachUsageToLastAssistantMessage = (
  messages: ChatMessage[],
  usage: UsageBreakdown | null,
): ChatMessage[] => {
  if (!usage) {
    return messages;
  }
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant || lastAssistant.usage) {
    return messages;
  }
  return messages.map((message) =>
    message.id === lastAssistant.id ? { ...message, usage } : message,
  );
};

export const ensureMessageOrder = (
  map: Map<string, number>,
  nextOrderRef: { current: number },
  items: ChatMessage[],
) => {
  items.forEach((message) => {
    if (!map.has(message.id)) {
      map.set(message.id, nextOrderRef.current++);
    }
  });
};

export const sortMessagesChronologically = (messages: ChatMessage[]) => {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(a.created_at) || 0;
    const bTime = Date.parse(b.created_at) || 0;
    if (aTime === bTime) {
      return a.id.localeCompare(b.id);
    }
    return aTime - bTime;
  });
};

export const mergeMessageHistory = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  if (incoming.length === 0) {
    return existing;
  }
  const mergedMap = new Map<string, ChatMessage>();
  existing.forEach((message) => mergedMap.set(message.id, message));
  incoming.forEach((message) => mergedMap.set(message.id, message));
  return sortMessagesChronologically(Array.from(mergedMap.values()));
};

export const pruneHistoryForEdit = (
  items: ChatMessage[],
  editMessageId: string,
  newContent: string,
): ChatMessage[] => {
  if (items.length === 0) {
    return items;
  }
  const sorted = sortMessagesChronologically(items);
  const targetIndex = sorted.findIndex((message) => message.id === editMessageId);
  if (targetIndex < 0) {
    return items;
  }
  const target = sorted[targetIndex];

  if (target.role === "user") {
    const trimmed = newContent.trim();
    return sorted.slice(0, targetIndex + 1).map((message) => {
      if (message.id !== editMessageId) {
        return message;
      }
      if (!trimmed) {
        return message;
      }
      return { ...message, content: trimmed };
    });
  }

  let lastUserIndex = -1;
  for (let idx = targetIndex - 1; idx >= 0; idx -= 1) {
    if (sorted[idx].role === "user") {
      lastUserIndex = idx;
      break;
    }
  }

  if (lastUserIndex < 0) {
    return sorted.slice(0, targetIndex);
  }

  let anchorIndex = -1;
  for (let idx = lastUserIndex + 1; idx < sorted.length; idx += 1) {
    if (sorted[idx].role !== "user") {
      anchorIndex = idx;
      break;
    }
  }

  if (anchorIndex < 0) {
    return sorted.slice(0, lastUserIndex + 1);
  }

  return sorted.slice(0, anchorIndex);
};
