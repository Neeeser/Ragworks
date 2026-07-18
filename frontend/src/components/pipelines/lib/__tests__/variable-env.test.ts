import { describe, expect, it } from "vitest";

import { acceptedArgumentNames, buildStaticEnvironment, inputVariables } from "../variable-env";

import type { PipelineVariable } from "@/lib/types";

const RETRIEVAL_INPUT = "retrieval.input";

const TOP_K: PipelineVariable = {
  name: "top_k",
  type: "integer",
  source: "input",
  value: 5,
  minimum: 1,
  maximum: 10,
};

describe("acceptedArgumentNames", () => {
  it("reads names off retrieval.input configs and ignores malformed shapes", () => {
    const nodes = [
      { type: RETRIEVAL_INPUT, config: { arguments: ["top_k", { bogus: true }] } },
      { type: "retriever.vector", config: { arguments: ["nope"] } },
      { type: RETRIEVAL_INPUT, config: { arguments: "garbage" } },
      { type: RETRIEVAL_INPUT, config: { arguments: ["top_k", "mode"] } },
    ];
    expect(acceptedArgumentNames(nodes)).toEqual(["top_k", "mode"]);
  });
});

describe("inputVariables", () => {
  it("selects input-source variables only", () => {
    const variables: PipelineVariable[] = [
      TOP_K,
      { name: "constant", type: "integer", value: 7 },
      { name: "derived", type: "integer", expression: "top_k * 2" },
    ];
    expect(inputVariables(variables).map((variable) => variable.name)).toEqual(["top_k"]);
  });
});

describe("buildStaticEnvironment", () => {
  it("seeds query, input defaults, and marks caller input tainted", () => {
    const env = buildStaticEnvironment([TOP_K]);
    expect(env.values.get("query")).toBe("");
    expect(env.values.get("top_k")).toBe(5);
    expect(env.tainted.has("top_k")).toBe(true);
    expect(env.tainted.has("query")).toBe(true);
    expect(env.sources.get("top_k")).toBe("input");
  });

  it("uses a constraint-respecting placeholder when an input has no default", () => {
    const env = buildStaticEnvironment([{ ...TOP_K, value: null, minimum: 3 }]);
    expect(env.values.get("top_k")).toBe(3);
  });

  it("evaluates derived variables in dependency order and propagates taint", () => {
    const variables: PipelineVariable[] = [
      TOP_K,
      { name: "candidates", type: "integer", expression: "doubled + 1" },
      { name: "doubled", type: "integer", expression: "top_k * 2" },
      { name: "constant", type: "integer", value: 7 },
    ];
    const env = buildStaticEnvironment(variables);
    expect(env.values.get("doubled")).toBe(10);
    expect(env.values.get("candidates")).toBe(11);
    expect(env.tainted.has("candidates")).toBe(true);
    expect(env.tainted.has("constant")).toBe(false);
    expect(env.problems.size).toBe(0);
    expect(env.sources.get("candidates")).toBe("expression");
    expect(env.sources.get("constant")).toBe("value");
  });

  it("reports cycles as per-variable problems without throwing", () => {
    const variables: PipelineVariable[] = [
      { name: "a", type: "integer", expression: "b + 1" },
      { name: "b", type: "integer", expression: "a + 1" },
    ];
    const env = buildStaticEnvironment(variables);
    expect(env.problems.get("a")).toMatch(/cycle/);
    expect(env.problems.get("b")).toMatch(/cycle/);
  });

  it("flags a variable with neither value nor expression", () => {
    const env = buildStaticEnvironment([{ name: "empty", type: "string" }]);
    expect(env.problems.get("empty")).toMatch(/value or an expression/);
  });
});
