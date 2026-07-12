import { afterEach, describe, expect, it, vi } from "vitest";

import { formatDateTime, parseApiDate, resolvedTimeZone } from "@/lib/datetime";
import { timeAgo } from "@/lib/utils";

describe("parseApiDate", () => {
  it("treats offset-less API timestamps as UTC, not local time", () => {
    // Regression: backend timestamps without a zone suffix were parsed as
    // local time, showing times hours behind reality outside UTC.
    expect(parseApiDate("2026-07-12T15:30:00").getTime()).toBe(
      Date.UTC(2026, 6, 12, 15, 30, 0),
    );
    expect(parseApiDate("2026-07-12T15:30:00.123456").getTime()).toBe(
      Date.UTC(2026, 6, 12, 15, 30, 0, 123),
    );
  });

  it("leaves zone-suffixed timestamps and Date instances untouched", () => {
    expect(parseApiDate("2026-07-12T15:30:00Z").getTime()).toBe(Date.UTC(2026, 6, 12, 15, 30));
    expect(parseApiDate("2026-07-12T15:30:00+00:00").getTime()).toBe(
      Date.UTC(2026, 6, 12, 15, 30),
    );
    expect(parseApiDate("2026-07-12T11:30:00-04:00").getTime()).toBe(
      Date.UTC(2026, 6, 12, 15, 30),
    );
    const date = new Date();
    expect(parseApiDate(date)).toBe(date);
  });
});

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures naive UTC timestamps against UTC now, not local now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T15:35:00Z"));
    // 5 minutes ago in UTC; parsed as local time on an Eastern machine this
    // would read "in about 4 hours" / "4 hours ago" instead.
    expect(timeAgo("2026-07-12T15:30:00")).toBe(timeAgo("2026-07-12T15:30:00Z"));
    expect(timeAgo("2026-07-12T15:30:00")).toContain("5 minutes ago");
  });
});

describe("formatDateTime", () => {
  it("falls back to a dash for empty or unparseable values", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("formats in the resolved timezone", () => {
    const formatted = formatDateTime("2026-07-12T15:30:00Z");
    expect(formatted).toContain("2026");
    expect(resolvedTimeZone()).toBeTruthy();
  });
});
