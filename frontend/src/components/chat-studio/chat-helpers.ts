"use client";

import { DEFAULT_TELEMETRY_ORDER } from "@/components/chat-studio/chat-constants";

import { coerceRecord, normalizeReasoningSegments, safeParseJSON } from "./chat-utils";

import type { ProviderFormState } from "@/components/chat-studio/types";
import type {
  ChatMessage,
  ProviderPreferences,
  ReasoningTraceSegment,
  RunSettingsSectionKey,
  ToolCallTrace,
  UsageBreakdown,
} from "@/lib/types";

const TELEMETRY_SECTION_SET = new Set(DEFAULT_TELEMETRY_ORDER);
const OPTIMISTIC_CLOCK_SKEW_MS = 5_000;

export const normalizeRunSettingsOrder = (
  order?: RunSettingsSectionKey[] | null,
): RunSettingsSectionKey[] => {
  if (!order || order.length === 0) {
    return [...DEFAULT_TELEMETRY_ORDER];
  }
  const seen = new Set<RunSettingsSectionKey>();
  const normalized: RunSettingsSectionKey[] = [];
  for (const entry of order) {
    if (!TELEMETRY_SECTION_SET.has(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    normalized.push(entry);
  }
  for (const entry of DEFAULT_TELEMETRY_ORDER) {
    if (!seen.has(entry)) {
      normalized.push(entry);
    }
  }
  return normalized;
};

export const createDefaultProviderForm = (): ProviderFormState => ({
  sort: "",
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: false,
  dataCollection: "allow",
  zdr: false,
  enforceDistillableText: false,
  maxPrompt: "",
  maxCompletion: "",
  maxRequest: "",
  maxImage: "",
});

export const createProviderFormFromPreferences = (
  preferences?: ProviderPreferences | null,
): ProviderFormState => {
  const defaults = createDefaultProviderForm();
  if (!preferences) {
    return defaults;
  }
  const maxPrice = preferences.max_price ?? {};
  return {
    ...defaults,
    order: preferences.order ?? [],
    only: preferences.only ?? [],
    ignore: preferences.ignore ?? [],
    quantizations: preferences.quantizations ?? [],
    sort: preferences.sort ?? "",
    allowFallbacks: preferences.allow_fallbacks ?? true,
    requireParameters: preferences.require_parameters ?? false,
    dataCollection: preferences.data_collection ?? "allow",
    zdr: preferences.zdr ?? false,
    enforceDistillableText: preferences.enforce_distillable_text ?? false,
    maxPrompt: maxPrice.prompt != null ? String(maxPrice.prompt) : "",
    maxCompletion: maxPrice.completion != null ? String(maxPrice.completion) : "",
    maxRequest: maxPrice.request != null ? String(maxPrice.request) : "",
    maxImage: maxPrice.image != null ? String(maxPrice.image) : "",
  };
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

export const generateClientSessionId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    if (char === "x") {
      return rand.toString(16);
    }
    // Ensure the variant bits are 10xx for UUID v4 compatibility
    return ((rand & 0x3) | 0x8).toString(16);
  });
};

export const generateClientMessageId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `client-${crypto.randomUUID()}`;
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

export const parseCollectionIdsParam = (value: string | null): string[] => {
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  return value.split(",").reduce<string[]>((acc, raw) => {
    const decoded = decodeURIComponent(raw.trim());
    if (!decoded || seen.has(decoded)) {
      return acc;
    }
    seen.add(decoded);
    acc.push(decoded);
    return acc;
  }, []);
};

export const areArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

export const buildCollectionsQuery = (collectionIds: string[]): string => {
  if (collectionIds.length === 0) {
    return "";
  }
  const encoded = collectionIds.map((collectionId) => encodeURIComponent(collectionId));
  return `collections=${encoded.join(",")}`;
};
