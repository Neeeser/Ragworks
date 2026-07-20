import { describe, expect, it } from "vitest";

import {
  formatMetric,
  formatPercent,
  groupMetrics,
  isRunActive,
  parseMetricKey,
} from "@/components/evals/lib/metrics";

import type { EvalMetricInfo } from "@/lib/types";

const CATALOG: EvalMetricInfo[] = [
  {
    name: "recall",
    label: "Recall@k",
    description: "Fraction of gold found.",
    is_rank_aware: false,
  },
  { name: "mrr", label: "MRR@k", description: "First-hit rank.", is_rank_aware: true },
];

describe("parseMetricKey", () => {
  it("splits a name@k key", () => {
    expect(parseMetricKey("recall@10")).toEqual({ name: "recall", k: 10 });
  });

  it("rejects keys without a numeric cutoff", () => {
    expect(parseMetricKey("recall")).toBeNull();
    expect(parseMetricKey("recall@abc")).toBeNull();
    expect(parseMetricKey("@5")).toBeNull();
  });
});

describe("groupMetrics", () => {
  it("groups by metric in catalog order with k ascending", () => {
    const groups = groupMetrics({ "mrr@5": 0.5, "recall@10": 0.8, "recall@1": 0.2 }, CATALOG);
    expect(groups.map((group) => group.name)).toEqual(["recall", "mrr"]);
    expect(groups[0].values).toEqual([
      { k: 1, value: 0.2 },
      { k: 10, value: 0.8 },
    ]);
    expect(groups[0].description).toBe("Fraction of gold found.");
  });

  it("keeps metrics missing from the catalog instead of dropping them", () => {
    const groups = groupMetrics({ "ndcg@5": 0.7 }, CATALOG);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("ndcg");
  });
});

describe("formatting", () => {
  it("formats metric values to two decimals and dashes the absent", () => {
    expect(formatMetric(0.8)).toBe("0.80");
    expect(formatMetric(undefined)).toBe("—");
    expect(formatMetric(Number.NaN)).toBe("—");
  });

  it("formats retention as a rounded percent", () => {
    expect(formatPercent(0.756)).toBe("76%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("isRunActive", () => {
  it("treats pending/provisioning/ingesting/running as active", () => {
    expect(isRunActive("running")).toBe(true);
    expect(isRunActive("ingesting")).toBe(true);
    expect(isRunActive("completed")).toBe(false);
    expect(isRunActive("cancelled")).toBe(false);
  });
});
