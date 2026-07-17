import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionHistoryPolling } from "@/components/chat-studio/hooks/session/use-session-history-polling";
import * as apiModule from "@/lib/api";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

function renderPolling(sessionId: string, pendingIds: Set<string>) {
  return renderHook(() =>
    useSessionHistoryPolling({
      authToken: "token",
      selectedSessionId: sessionId,
      isStreamingResponseRef: { current: false },
      pendingSessionIdsRef: { current: pendingIds },
      syncMessages: vi.fn(),
      setToolTraces: vi.fn(),
      setUsage: vi.fn(),
    }),
  );
}

const NEW_SESSION_ID = "session-new";

describe("useSessionHistoryPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.getChatHistory.mockReset();
    api.getChatHistory.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers the first poll while the session is still being created", async () => {
    // The first turn's POST is what creates the session row; an immediate poll
    // is a guaranteed 404. The interval takes the first look instead.
    const hook = renderPolling(NEW_SESSION_ID, new Set([NEW_SESSION_ID]));
    act(() => hook.result.current.startProgressPolling(NEW_SESSION_ID));
    expect(api.getChatHistory).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(api.getChatHistory).toHaveBeenCalledTimes(1);
  });

  it("polls immediately for an already-persisted session", async () => {
    const hook = renderPolling("session-old", new Set());
    await act(async () => {
      hook.result.current.startProgressPolling("session-old");
    });
    expect(api.getChatHistory).toHaveBeenCalledTimes(1);
  });
});
