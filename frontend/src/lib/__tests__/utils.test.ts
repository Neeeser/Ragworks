import { afterEach, describe, expect, it, vi } from "vitest";

import { cn, isReasoningModel, prettyJson, timeAgo, truncate } from "@/lib/utils";

describe("utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("combines class names and drops falsey values", () => {
    expect(cn("a", false, null, "b", undefined, "c")).toBe("a b c");
  });

  it("formats relative time or fallback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T00:00:00.000Z"));
    expect(timeAgo(null)).toBe("\u2014");
    const result = timeAgo("2024-01-01T00:00:00.000Z");
    expect(result).toContain("ago");
    const dateResult = timeAgo(new Date("2024-01-01T00:00:00.000Z"));
    expect(dateResult).toContain("ago");
  });

  it("truncates when over limit", () => {
    expect(truncate("", 2)).toBe("");
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("truncate", 3)).toBe(`tru\u2026`);
  });

  it("pretty prints JSON with a fallback", () => {
    expect(prettyJson(null, "n/a")).toBe("n/a");
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("{oops}", "fallback")).toBe("fallback");
  });

  it("detects reasoning models", () => {
    expect(isReasoningModel(null)).toBe(false);
    expect(isReasoningModel("gpt-oss-120b")).toBe(true);
    expect(isReasoningModel("reasoning-model")).toBe(true);
    expect(isReasoningModel("plain-model")).toBe(false);
  });
});
