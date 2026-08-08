import { describe, expect, it } from "vitest";

import {
  deltaTextClass,
  formatDelta,
  formatPercentDelta,
  metricDeltaRows,
  queryKindCounts,
  runLabel,
} from "@/components/evals/lib/comparison";

import type { EvalQueryDelta } from "@/lib/types";

const query = (overrides: Partial<EvalQueryDelta>): EvalQueryDelta => ({
  query_external_id: "q1",
  query_text: "why",
  kind: "unchanged",
  degraded_a: false,
  degraded_b: false,
  ...overrides,
});

describe("comparison display helpers", () => {
  it("names a metric once per block so its cutoffs read down", () => {
    const rows = metricDeltaRows([
      { metric: "recall", k: 5 },
      { metric: "recall", k: 10 },
      { metric: "ndcg", k: 5 },
    ]);
    expect(rows.map((row) => row.first)).toEqual([true, false, true]);
  });

  it("signs a delta and renders an absent one as an em-dash, never a zero", () => {
    expect(formatDelta(0.213)).toBe("+0.21");
    expect(formatDelta(-0.213)).toBe("−0.21");
    expect(formatDelta(0)).toBe("0.00");
    expect(formatDelta(null)).toBe("—");
    expect(formatDelta(undefined)).toBe("—");
  });

  it("renders a retention delta in percentage points", () => {
    expect(formatPercentDelta(0.1)).toBe("+10 pt");
    expect(formatPercentDelta(-0.25)).toBe("−25 pt");
    expect(formatPercentDelta(0)).toBe("0 pt");
    expect(formatPercentDelta(null)).toBe("—");
  });

  it("colours a movement by direction and leaves display-precision noise neutral", () => {
    expect(deltaTextClass(0.2)).toBe("text-data-pos");
    expect(deltaTextClass(-0.2)).toBe("text-data-neg");
    expect(deltaTextClass(0.0001)).toBe("text-muted");
    expect(deltaTextClass(null)).toBe("text-muted");
  });

  it("counts queries by how they moved", () => {
    const counts = queryKindCounts([
      query({ kind: "improved" }),
      query({ kind: "improved" }),
      query({ kind: "regressed" }),
      query({ kind: "only_b" }),
    ]);
    expect(counts).toEqual({ improved: 2, regressed: 1, unchanged: 0, only_a: 0, only_b: 1 });
  });

  it("falls back to a short id when a run was never named", () => {
    expect(runLabel({ id: "abcdef1234", name: null })).toBe("Run abcdef12");
    expect(runLabel({ id: "abcdef1234", name: "Hybrid" })).toBe("Hybrid");
  });
});
