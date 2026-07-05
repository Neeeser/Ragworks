import { describe, expect, it } from "vitest";

import {
  chatStreamReducer,
  initialChatStreamState,
  upsertLiveToolEvents,
  type ChatStreamState,
} from "@/components/chat-studio/hooks/use-chat-stream";

import type { ReasoningTraceSegment } from "@/lib/types";

const seg = (text: string): ReasoningTraceSegment => ({ text }) as ReasoningTraceSegment;

describe("chatStreamReducer", () => {
  it("RESET returns live-message and reasoning state to their initial values", () => {
    const dirty: ChatStreamState = {
      ...initialChatStreamState,
      liveResponse: "partial answer",
      isStreamingResponse: true,
      liveReasoningSegments: [seg("thinking")],
      liveReasoningBlocks: [[seg("done")]],
      liveReasoningPhase: 3,
      persistedLiveReasoningSegments: [seg("persisted")],
      activeStreamEntryKey: "stream-1",
      finalStreamAssistantId: "assistant-1",
      streamEntryKeyMap: { "assistant-1": "stream-1" },
    };

    const next = chatStreamReducer(dirty, { type: "RESET" });

    expect(next.liveResponse).toBe("");
    expect(next.isStreamingResponse).toBe(false);
    expect(next.liveReasoningSegments).toEqual([]);
    expect(next.liveReasoningBlocks).toEqual([]);
    expect(next.liveReasoningPhase).toBe(0);
    expect(next.persistedLiveReasoningSegments).toEqual([]);
    expect(next.activeStreamEntryKey).toBeNull();
    expect(next.finalStreamAssistantId).toBeNull();
    expect(next.streamEntryKeyMap).toEqual({});
  });

  // Mutation check: if RESET stops clearing liveResponse, this assertion must fail.
  it("RESET is the single path that clears a partial live response", () => {
    const next = chatStreamReducer(
      { ...initialChatStreamState, liveResponse: "leftover tokens" },
      { type: "RESET" },
    );
    expect(next.liveResponse).toBe("");
  });

  it("TOKEN accumulates text and bumps the animation key only on the first non-empty token", () => {
    const first = chatStreamReducer(initialChatStreamState, { type: "TOKEN", token: "Hel" });
    expect(first.liveResponse).toBe("Hel");
    expect(first.liveResponseAnimationKey).toBe(1);

    const second = chatStreamReducer(first, { type: "TOKEN", token: "lo" });
    expect(second.liveResponse).toBe("Hello");
    // Already had text, so the animation key stays put.
    expect(second.liveResponseAnimationKey).toBe(1);

    const empty = chatStreamReducer(second, { type: "TOKEN", token: "" });
    expect(empty).toBe(second);
  });

  it("TOOL_CALL upserts a live tool event, records order, and advances the reasoning phase", () => {
    const called = chatStreamReducer(initialChatStreamState, {
      type: "TOOL_CALL",
      toolId: "tool-1",
      phaseIndex: 0,
      update: { id: "tool-1", name: "search", arguments: { q: "hello" } },
    });

    expect(called.liveToolOrder).toEqual(["tool-1"]);
    expect(called.liveToolPhaseById).toEqual({ "tool-1": 0 });
    expect(called.liveReasoningPhase).toBe(1);
    expect(called.liveToolEvents).toHaveLength(1);
    expect(called.liveToolEvents[0].name).toBe("search");
    expect(called.liveToolEvents[0].arguments).toEqual({ q: "hello" });

    const resolved = chatStreamReducer(called, {
      type: "TOOL_RESULT",
      toolId: "tool-1",
      fallbackPhase: 0,
      update: { id: "tool-1", response: { hits: 3 } },
    });

    // Same id merges onto the existing entry rather than appending a new one.
    expect(resolved.liveToolEvents).toHaveLength(1);
    expect(resolved.liveToolEvents[0].response).toEqual({ hits: 3 });
    expect(resolved.liveToolEvents[0].name).toBe("search");
    expect(resolved.liveToolOrder).toEqual(["tool-1"]);
  });

  it("upsertLiveToolEvents merges incremental fields onto an existing event", () => {
    const withCall = upsertLiveToolEvents([], {
      id: "t1",
      name: "search",
      arguments: { a: 1 },
    });
    expect(withCall).toHaveLength(1);

    const withResult = upsertLiveToolEvents(withCall, {
      id: "t1",
      arguments: { b: 2 },
      response: { ok: true },
    });
    expect(withResult).toHaveLength(1);
    expect(withResult[0].arguments).toEqual({ a: 1, b: 2 });
    expect(withResult[0].response).toEqual({ ok: true });
  });

  it("STREAM_FINISHED clears live text and maps the final assistant id to its stream key", () => {
    const streaming: ChatStreamState = {
      ...initialChatStreamState,
      liveResponse: "answer",
      isStreamingResponse: true,
      liveReasoningSegments: [seg("thinking")],
    };
    const next = chatStreamReducer(streaming, {
      type: "STREAM_FINISHED",
      finalAssistantId: "assistant-9",
      streamKey: "stream-9",
      streamedReasoningSegments: [seg("all")],
    });
    expect(next.liveResponse).toBe("");
    expect(next.isStreamingResponse).toBe(false);
    expect(next.persistedLiveReasoningSegments).toEqual([seg("all")]);
    expect(next.streamEntryKeyMap).toEqual({ "assistant-9": "stream-9" });
  });

  it("PRUNE_LIVE_TOOLS drops live events whose persisted counterparts have arrived", () => {
    const withTools: ChatStreamState = {
      ...initialChatStreamState,
      liveToolEvents: [
        { id: "a", name: "search", arguments: {} },
        { id: "b", name: "fetch", arguments: {} },
      ],
    };
    const next = chatStreamReducer(withTools, {
      type: "PRUNE_LIVE_TOOLS",
      persistedToolIds: new Set(["a"]),
    });
    expect(next.liveToolEvents.map((event) => event.id)).toEqual(["b"]);
  });
});
