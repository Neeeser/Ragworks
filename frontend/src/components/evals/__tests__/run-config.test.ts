import { describe, expect, it } from "vitest";

import {
  clampToBounds,
  coerceInputs,
  defaultInputValue,
  effectiveResultDepth,
  isDepthVariable,
  truncatedCutoffs,
} from "@/components/evals/lib/run-config";
import { makePipeline } from "@/test/fixtures";

import type { PipelineVariable } from "@/lib/types";

function makeVariable(overrides: Partial<PipelineVariable> = {}): PipelineVariable {
  return {
    name: "result_limit",
    type: "integer",
    source: "input",
    description: "Maximum number of results to return.",
    value: 5,
    minimum: 1,
    maximum: 10,
    ...overrides,
  };
}

describe("isDepthVariable", () => {
  it("matches limit/top_k style integer inputs and rejects the rest", () => {
    expect(isDepthVariable(makeVariable())).toBe(true);
    expect(isDepthVariable(makeVariable({ name: "top_k" }))).toBe(true);
    expect(isDepthVariable(makeVariable({ name: "topk" }))).toBe(true);
    expect(isDepthVariable(makeVariable({ name: "namespace", type: "string" }))).toBe(false);
    expect(isDepthVariable(makeVariable({ name: "temperature", type: "number" }))).toBe(false);
  });
});

describe("depth defaults and clamping", () => {
  it("defaults a depth variable to the largest cutoff, clamped to its bounds", () => {
    expect(defaultInputValue(makeVariable(), 25)).toBe("10");
    expect(defaultInputValue(makeVariable({ maximum: 100 }), 25)).toBe("25");
  });

  it("keeps declared defaults for non-depth variables", () => {
    expect(
      defaultInputValue(makeVariable({ name: "namespace", type: "string", value: "ns" }), 25),
    ).toBe("ns");
  });

  it("clamps typed values into the variable's declared bounds", () => {
    const inputs = coerceInputs({ result_limit: "500" }, [makeVariable()], 25);
    expect(inputs).toEqual({ result_limit: 10 });
    expect(clampToBounds(makeVariable(), 0)).toBe(1);
  });
});

describe("effectiveResultDepth", () => {
  it("reports the bound depth variable as the cap when it is the minimum", () => {
    const pipeline = makePipeline({
      definition: {
        nodes: [],
        edges: [],
        variables: [makeVariable()],
      },
    });
    const cap = effectiveResultDepth(pipeline.definition, { result_limit: 10 }, 25);
    expect(cap).toEqual({ depth: 10, label: "result_limit" });
    expect(truncatedCutoffs([1, 5, 10, 25], cap.depth)).toEqual([25]);
  });

  it("reports a static node top_k as the cap", () => {
    const pipeline = makePipeline({
      definition: {
        nodes: [
          {
            id: "node-1",
            type: "retriever.pgvector",
            name: "Semantic Retriever",
            config: { top_k: 5 },
          },
        ],
        edges: [],
      },
    });
    const cap = effectiveResultDepth(pipeline.definition, {}, 25);
    expect(cap).toEqual({ depth: 5, label: "Semantic Retriever" });
  });

  it("falls back to the run's own request depth when nothing caps it", () => {
    const pipeline = makePipeline({
      definition: {
        nodes: [
          {
            id: "node-1",
            type: "limit.results",
            name: "Result Limit",
            config: { max_results: { $expr: "result_limit" } },
          },
        ],
        edges: [],
      },
    });
    expect(effectiveResultDepth(pipeline.definition, {}, 25)).toEqual({ depth: 25, label: "" });
    expect(truncatedCutoffs([1, 5, 10, 25], 25)).toEqual([]);
  });
});
