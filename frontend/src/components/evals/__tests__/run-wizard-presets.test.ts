import { describe, expect, it } from "vitest";

import { PRESETS, presetDetail, resolveCount } from "@/components/evals/lib/run-wizard-presets";

import type { EvalDataset } from "@/lib/types";

function makeDataset(numQueries: number, numCorpusDocs: number): EvalDataset {
  return { num_queries: numQueries, num_corpus_docs: numCorpusDocs } as EvalDataset;
}

describe("presetDetail", () => {
  it("describes what the dataset can actually supply, not the preset's ceiling", () => {
    // A static "50 queries, 200 distractors" promises a scope a small dataset
    // can never deliver, and the run then reports "3 evaluated" — the preset
    // reads as a broken run rather than a dataset smaller than the ceiling.
    expect(presetDetail(PRESETS[0], makeDataset(3, 12))).toBe("3 queries, 12 distractors");
  });

  it("uses the preset's ceiling when the dataset exceeds it", () => {
    expect(presetDetail(PRESETS[0], makeDataset(5000, 20000))).toBe("50 queries, 200 distractors");
  });

  it("describes an uncapped preset by the dataset's own totals", () => {
    const full = PRESETS[PRESETS.length - 1];
    expect(presetDetail(full, makeDataset(120, 900))).toBe("120 queries, 900 distractors");
  });

  it("reads naturally when the dataset holds a single query", () => {
    expect(presetDetail(PRESETS[0], makeDataset(1, 1))).toBe("1 query, 1 distractor");
  });

  it("falls back to the preset's own ceiling with no dataset loaded", () => {
    expect(presetDetail(PRESETS[0], null)).toBe("50 queries, 200 distractors");
  });
});

describe("resolveCount", () => {
  it("clamps a preset ceiling to what the dataset holds", () => {
    // Persisting 50 against a three-query dataset stores a run that cannot
    // happen, and the run header then reports a scope its own results
    // contradict.
    expect(resolveCount("", 50, 3)).toBe(3);
  });

  it("clamps an explicit override the same way", () => {
    expect(resolveCount("500", 50, 3)).toBe(3);
  });

  it("keeps an override the dataset can serve", () => {
    expect(resolveCount("2", 50, 3)).toBe(2);
  });

  it("uses the dataset total for an uncapped preset", () => {
    expect(resolveCount("", null, 3)).toBe(3);
  });
});
