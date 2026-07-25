import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatContextLength,
  formatLatency,
  formatPricePerMillion,
} from "@/lib/format";

describe("formatPricePerMillion", () => {
  it("formats a per-token price as $/M", () => {
    expect(formatPricePerMillion(0.000003)).toBe("$3.00/M");
    expect(formatPricePerMillion("0.000015")).toBe("$15.0/M");
  });

  it("returns null for missing values and unparseable strings", () => {
    expect(formatPricePerMillion(null)).toBeNull();
    expect(formatPricePerMillion(undefined)).toBeNull();
    expect(formatPricePerMillion("   ")).toBeNull();
  });

  it("labels OpenRouter's negative variable-pricing sentinel instead of a nonsense price", () => {
    expect(formatPricePerMillion(-1)).toBe("Variable");
    expect(formatPricePerMillion("-1")).toBe("Variable");
  });

  it("formats zero as a zero price", () => {
    expect(formatPricePerMillion(0)).toBe("$0.00/M");
  });
});

describe("formatLatency", () => {
  it("rounds to whole milliseconds", () => {
    expect(formatLatency(12.4)).toBe("12 ms");
  });

  it("falls back to n/a", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

describe("formatContextLength", () => {
  it("renders counts under a thousand verbatim", () => {
    expect(formatContextLength(512)).toBe("512");
  });

  it("compacts thousands to whole K", () => {
    expect(formatContextLength(128_000)).toBe("128K");
    expect(formatContextLength(131_072)).toBe("131K");
  });

  it("compacts millions to at most one decimal M", () => {
    expect(formatContextLength(1_000_000)).toBe("1M");
    expect(formatContextLength(2_000_000)).toBe("2M");
    expect(formatContextLength(1_500_000)).toBe("1.5M");
  });

  it("promotes a count that rounds up to 1000K into 1M", () => {
    expect(formatContextLength(999_999)).toBe("1M");
  });
});

describe("formatBytes", () => {
  it("scales through units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });

  it("keeps a fraction digit only below ten of a unit", () => {
    // A size column whose rows disagree on fraction digits is unreadable, so
    // the switch is on the value rather than the unit.
    expect(formatBytes(9.5 * 1024)).toBe("9.5 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
  });
});
