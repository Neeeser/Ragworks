import { describe, expect, it, vi } from "vitest";

import {
  attachUsageToLastAssistantMessage,
  calculateSessionUsage,
  deriveToolTracesFromMessages,
  ensureMessageOrder,
  isOptimisticDuplicate,
  isToolReasoningSegment,
  mergeMessageHistory,
  pruneHistoryForEdit,
  sortMessagesChronologically,
} from "@/components/chat-studio/chat-entry-helpers";
import {
  areArraysEqual,
  buildCollectionsQuery,
  generateClientMessageId,
  generateClientSessionId,
  normalizeRunSettingsOrder,
  parseCollectionIdsParam,
} from "@/components/chat-studio/chat-helpers";
import {
  createDefaultProviderForm,
  createProviderFormFromPreferences,
} from "@/components/chat-studio/chat-payload-helpers";

import type {
  ChatMessage,
  ProviderPreferences,
  ReasoningTraceSegment,
  UsageBreakdown,
} from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

describe("ChatStudio helpers", () => {
  it("normalizes run settings order", () => {
    expect(normalizeRunSettingsOrder(null)).toEqual([
      "systemPrompt",
      "collectionTools",
      "streaming",
      "modelRouting",
      "providerRouting",
      "vitals",
      "modelParameters",
      "usage",
    ]);

    expect(
      normalizeRunSettingsOrder(["usage", "usage", "modelRouting", "invalid" as "modelRouting"]),
    ).toEqual([
      "usage",
      "modelRouting",
      "systemPrompt",
      "collectionTools",
      "streaming",
      "providerRouting",
      "vitals",
      "modelParameters",
    ]);
  });

  it("builds provider forms from preferences", () => {
    const defaults = createDefaultProviderForm();
    expect(defaults.allowFallbacks).toBe(true);

    expect(createProviderFormFromPreferences(null)).toEqual(defaults);

    const prefs: ProviderPreferences = {
      order: ["a"],
      allow_fallbacks: false,
      max_price: { prompt: 1.2 },
    };
    const form = createProviderFormFromPreferences(prefs);
    expect(form.order).toEqual(["a"]);
    expect(form.allowFallbacks).toBe(false);
    expect(form.maxPrompt).toBe("1.2");
  });

  it("derives tool traces from messages", () => {
    const toolMessage: ChatMessage = {
      id: "m1",
      session_id: "s1",
      role: "tool",
      content: '{"response":{"ok":true}}',
      tool_name: "search",
      tool_call_id: "call-1",
      created_at: baseTimestamp,
    };

    const traces = deriveToolTracesFromMessages([toolMessage]);
    expect(traces[0].name).toBe("search");
    expect(traces[0].arguments).toEqual({});
    expect(traces[0].response).toEqual({ ok: true });

    const payloadMessage: ChatMessage = {
      id: "m2",
      session_id: "s1",
      role: "tool",
      content: "not-json",
      tool_name: "payload",
      tool_call_id: null,
      tool_payload: { arguments: { q: "hi" }, response: { ok: true } },
      // The legacy wire format also allows a bare segments array; cast around the
      // narrower object-shaped type to exercise that normalization path.
      reasoning_trace: [
        { type: "text", content: "step" },
      ] as unknown as ChatMessage["reasoning_trace"],
      created_at: baseTimestamp,
    };
    const payloadTraces = deriveToolTracesFromMessages([payloadMessage]);
    expect(payloadTraces[0].arguments).toEqual({ q: "hi" });
    expect(payloadTraces[0].response).toEqual({ ok: true });
  });

  it("calculates and attaches usage", () => {
    const usage: UsageBreakdown = {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      reasoning_tokens: 4,
      cost: 0.01,
    };
    const messages: ChatMessage[] = [
      {
        id: "m1",
        session_id: "s1",
        role: "assistant",
        content: "Hi",
        created_at: baseTimestamp,
        usage,
      },
    ];
    expect(calculateSessionUsage(messages)).toEqual(usage);
    expect(attachUsageToLastAssistantMessage(messages, usage)).toEqual(messages);
    expect(calculateSessionUsage([])).toBeNull();

    const withoutUsage: ChatMessage[] = [
      {
        id: "m2",
        session_id: "s1",
        role: "assistant",
        content: "Ok",
        created_at: baseTimestamp,
      },
    ];
    const attached = attachUsageToLastAssistantMessage(withoutUsage, usage);
    expect(attached[0].usage).toEqual(usage);

    expect(attachUsageToLastAssistantMessage(withoutUsage, null)).toEqual(withoutUsage);
    expect(attachUsageToLastAssistantMessage([{ ...withoutUsage[0], usage }], usage)).toEqual([
      { ...withoutUsage[0], usage },
    ]);
  });

  it("detects tool reasoning segments", () => {
    const toolSegment: ReasoningTraceSegment = { type: "tool_call", content: "" };
    expect(isToolReasoningSegment(toolSegment)).toBe(true);
    expect(isToolReasoningSegment({ type: "text", content: "" })).toBe(false);
    expect(
      isToolReasoningSegment({
        type: "text",
        content: "",
        tool_name: "x",
      } as ReasoningTraceSegment),
    ).toBe(true);
  });

  it("generates client ids with and without crypto", () => {
    const original = globalThis.crypto;
    const randomUUID = vi.fn(() => "uuid");
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID }, configurable: true });

    expect(generateClientSessionId()).toBe("uuid");
    expect(generateClientMessageId()).toBe("client-uuid");

    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    expect(generateClientSessionId()).toMatch(/-/);
    expect(generateClientMessageId()).toMatch(/^client-/);

    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  });

  it("sorts and merges message history", () => {
    const messages: ChatMessage[] = [
      {
        id: "b",
        session_id: "s1",
        role: "user",
        content: "B",
        created_at: "2024-01-02T00:00:00.000Z",
      },
      {
        id: "a",
        session_id: "s1",
        role: "user",
        content: "A",
        created_at: baseTimestamp,
      },
    ];
    expect(sortMessagesChronologically(messages)[0].id).toBe("a");

    const merged = mergeMessageHistory(messages, [
      {
        id: "b",
        session_id: "s1",
        role: "user",
        content: "B2",
        created_at: "2024-01-02T00:00:00.000Z",
      },
    ]);
    expect(merged.find((msg) => msg.id === "b")?.content).toBe("B2");

    expect(mergeMessageHistory(messages, [])).toEqual(messages);
  });

  it("prunes history for edits", () => {
    expect(pruneHistoryForEdit([], "u1", "Updated")).toEqual([]);
    const user: ChatMessage = {
      id: "u1",
      session_id: "s1",
      role: "user",
      content: "Hi",
      created_at: baseTimestamp,
    };
    const assistant: ChatMessage = {
      id: "a1",
      session_id: "s1",
      role: "assistant",
      content: "Hello",
      created_at: "2024-01-01T00:01:00.000Z",
    };
    const followUp: ChatMessage = {
      id: "u2",
      session_id: "s1",
      role: "user",
      content: "Next",
      created_at: "2024-01-01T00:02:00.000Z",
    };

    const prunedUser = pruneHistoryForEdit([user, assistant], "u1", "Updated");
    expect(prunedUser).toHaveLength(1);
    expect(prunedUser[0].content).toBe("Updated");

    const prunedAssistant = pruneHistoryForEdit([user, assistant, followUp], "a1", "");
    expect(prunedAssistant).toHaveLength(1);

    const prunedMissing = pruneHistoryForEdit([user], "missing", "");
    expect(prunedMissing).toEqual([user]);

    const noUserBefore = pruneHistoryForEdit([assistant], "a1", "");
    expect(noUserBefore).toEqual([]);

    const noAnchor = pruneHistoryForEdit([user, followUp], "u2", "");
    expect(noAnchor).toHaveLength(2);
  });

  it("evaluates optimistic duplicates", () => {
    const messageOrder = new Map<string, number>([["o1", 1]]);
    const optimistic: ChatMessage = {
      id: "o1",
      session_id: "s1",
      role: "user",
      content: "Hello",
      created_at: baseTimestamp,
    };
    const persisted: ChatMessage = {
      id: "p1",
      session_id: "s1",
      role: "user",
      content: "Hello",
      created_at: "2024-01-01T00:00:01.000Z",
    };

    expect(isOptimisticDuplicate(optimistic, persisted, messageOrder)).toBe(true);

    const mismatch = { ...persisted, content: "Other" };
    expect(isOptimisticDuplicate(optimistic, mismatch, messageOrder)).toBe(false);

    const otherSession = { ...persisted, session_id: "s2" };
    expect(isOptimisticDuplicate(optimistic, otherSession, messageOrder)).toBe(false);

    const assistantRole = { ...persisted, role: "assistant" as const };
    expect(isOptimisticDuplicate(optimistic, assistantRole, messageOrder)).toBe(false);

    const orderMap = new Map<string, number>([
      ["o1", 1],
      ["p1", 2],
    ]);
    expect(isOptimisticDuplicate(optimistic, persisted, orderMap)).toBe(true);

    const invalidTime = { ...persisted, created_at: "invalid" };
    expect(isOptimisticDuplicate(optimistic, invalidTime, new Map())).toBe(true);
  });

  it("parses collections params and comparisons", () => {
    expect(parseCollectionIdsParam(null)).toEqual([]);
    expect(parseCollectionIdsParam("a,b,a")).toEqual(["a", "b"]);
    expect(areArraysEqual(["a"], ["a"])).toBe(true);
    expect(areArraysEqual(["a"], ["b"])).toBe(false);
    expect(buildCollectionsQuery(["a", "b"]).startsWith("collections=")).toBe(true);
    expect(buildCollectionsQuery([])).toBe("");
  });

  it("ensures message ordering", () => {
    const map = new Map<string, number>();
    const ref = { current: 1 };
    const messages: ChatMessage[] = [
      {
        id: "m1",
        session_id: "s1",
        role: "user",
        content: "Hi",
        created_at: baseTimestamp,
      },
    ];
    ensureMessageOrder(map, ref, messages);
    expect(map.get("m1")).toBe(1);
    expect(ref.current).toBe(2);
  });
});
