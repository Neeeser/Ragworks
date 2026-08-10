import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatUsage,
  runCost,
  runTokens,
  usageTokens,
} from "@/components/evals/lib/usage";
import { formatUsd } from "@/lib/format";

const START = "2026-08-09T10:00:00Z";

describe("usage reading", () => {
  it("falls back to the prompt side when a provider counts no total", () => {
    expect(usageTokens({ prompt_tokens: 400 })).toBe(400);
    expect(usageTokens({ prompt_tokens: 400, total_tokens: 420 })).toBe(420);
    expect(usageTokens({})).toBeNull();
    expect(usageTokens(null)).toBeNull();
  });

  it("sums a run's phases and keeps an unreported phase out of the total", () => {
    const usage = { ingestion: { total_tokens: 900 }, retrieval: { total_tokens: 60 } };
    expect(runTokens(usage)).toBe(960);
    expect(runTokens({ ingestion: {}, retrieval: { total_tokens: 60 } })).toBe(60);
    expect(runTokens({ ingestion: {}, retrieval: {} })).toBeNull();
  });

  it("reports no dollars at all when nothing was priced", () => {
    expect(runCost({ ingestion: { total_tokens: 10 }, retrieval: {} })).toBeNull();
    // One priced phase beside an unpriced one: a figure covering a subset of
    // the tokens would read as the whole run's cost.
    expect(
      runCost({
        ingestion: { total_tokens: 10, cost_usd: 0.002 },
        retrieval: { total_tokens: 5 },
      }),
    ).toBeNull();
    expect(runCost({ ingestion: { cost_usd: 0.002 }, retrieval: { cost_usd: 0.001 } })).toBeCloseTo(
      0.003,
    );
  });

  it("prints fractions of a cent rather than rounding a real cost to $0.00", () => {
    expect(formatUsd(0.0031)).toBe("$0.0031");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0)).toBe("$0");
  });

  it("writes a very small amount out in full rather than in exponent notation", () => {
    expect(formatUsd(0.00000003)).toBe("$0.00000003");
    expect(formatUsd(0.003)).toBe("$0.003");
  });

  it("drops the cost from the summary when no price was published", () => {
    expect(formatUsage(12340, 0.0031)).toBe("12,340 tokens · $0.0031");
    expect(formatUsage(12340, null)).toBe("12,340 tokens");
    expect(formatUsage(null, 0.5)).toBeNull();
  });

  it("reports elapsed time only once a run has finished", () => {
    expect(formatDuration(START, "2026-08-09T10:00:04.5Z")).toBe("4.5s");
    expect(formatDuration(START, "2026-08-09T10:02:30Z")).toBe("2m 30s");
    expect(formatDuration(START, "2026-08-09T12:05:00Z")).toBe("2h 5m");
    expect(formatDuration(START, null)).toBeNull();
  });
});
