import { describe, expect, it } from "vitest";

import { coverageLabel, readGenerationCoverage } from "@/components/evals/lib/generation-stats";
import { makeEvalDataset } from "@/test/fixtures";

describe("readGenerationCoverage", () => {
  it("reads document coverage from generation stats", () => {
    const dataset = makeEvalDataset({
      generation_config: {
        stats: { generated: 60, accepted: 40, documents_covered: 27, documents_total: 50 },
      },
    });
    const coverage = readGenerationCoverage(dataset);
    expect(coverage).toEqual({ documentsCovered: 27, documentsTotal: 50 });
    expect(coverageLabel(coverage!)).toBe("27 of 50 source documents (54%)");
  });

  it("returns null for datasets without coverage stats", () => {
    expect(readGenerationCoverage(makeEvalDataset({ generation_config: null }))).toBeNull();
    expect(
      readGenerationCoverage(
        makeEvalDataset({ generation_config: { stats: { generated: 10, accepted: 5 } } }),
      ),
    ).toBeNull();
    expect(
      readGenerationCoverage(
        makeEvalDataset({
          generation_config: { stats: { documents_covered: 3, documents_total: 0 } },
        }),
      ),
    ).toBeNull();
  });
});
