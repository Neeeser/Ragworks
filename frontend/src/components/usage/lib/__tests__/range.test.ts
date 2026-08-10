import { describe, expect, it } from "vitest";

import { buildBuckets, isCustomRangeValid, resolveRange } from "@/components/usage/lib/range";

const NOW = new Date("2026-08-09T13:45:00Z");

describe("usage range", () => {
  it("resolves a preset to that many days ending now", () => {
    const range = resolveRange({ preset: "7d", customStart: "", customEnd: "" }, NOW);

    expect(range.start).toBe("2026-08-02T13:45:00.000Z");
    expect(range.end).toBe("2026-08-09T13:45:00.000Z");
    expect(range.bucket).toBe("day");
  });

  it("covers the whole of a single custom day rather than an empty instant", () => {
    const range = resolveRange(
      { preset: "custom", customStart: "2026-08-04", customEnd: "2026-08-04" },
      NOW,
    );

    expect(new Date(range.end).getTime() - new Date(range.start).getTime()).toBe(86_400_000);
    // One day of data has too few daily ticks to read, so the axis goes hourly.
    expect(range.bucket).toBe("hour");
  });

  it("falls back to the default preset while a custom range is incomplete", () => {
    const state = { preset: "custom" as const, customStart: "2026-08-09", customEnd: "" };

    expect(isCustomRangeValid(state)).toBe(false);
    expect(resolveRange(state, NOW).start).toBe("2026-07-10T13:45:00.000Z");
  });

  it("rejects a custom range that runs backwards", () => {
    expect(
      isCustomRangeValid({ preset: "custom", customStart: "2026-08-09", customEnd: "2026-08-01" }),
    ).toBe(false);
  });

  it("builds ticks on the UTC boundaries the API truncates to", () => {
    const buckets = buildBuckets({
      start: "2026-08-01T13:45:00.000Z",
      end: "2026-08-03T09:00:00.000Z",
      bucket: "day",
    });

    expect(buckets).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
  });

  it("keeps quiet buckets on the axis instead of collapsing the timeline", () => {
    const buckets = buildBuckets({
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-08-01T04:30:00.000Z",
      bucket: "hour",
    });

    expect(buckets).toHaveLength(5);
  });
});
