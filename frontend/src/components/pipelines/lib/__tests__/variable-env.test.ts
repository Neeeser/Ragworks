import { describe, expect, it } from "vitest";

import { buildStaticEnvironment, declaredArguments } from "../variable-env";

import type { PipelineInputArgument, PipelineVariable } from "@/lib/types";

const TOP_K: PipelineInputArgument = {
  name: "top_k",
  type: "integer",
  default: 5,
  minimum: 1,
  maximum: 10,
};

describe("declaredArguments", () => {
  it("reads arguments off retrieval.input configs and ignores malformed shapes", () => {
    const nodes = [
      { type: "retrieval.input", config: { arguments: [TOP_K, { bogus: true }] } },
      { type: "retriever.vector", config: { arguments: [{ name: "nope" }] } },
      { type: "retrieval.input", config: { arguments: "garbage" } },
    ];
    expect(declaredArguments(nodes).map((argument) => argument.name)).toEqual(["top_k"]);
  });
});

describe("buildStaticEnvironment", () => {
  it("seeds query, argument defaults, and marks caller input tainted", () => {
    const env = buildStaticEnvironment([TOP_K], []);
    expect(env.values.get("query")).toBe("");
    expect(env.values.get("top_k")).toBe(5);
    expect(env.tainted.has("top_k")).toBe(true);
    expect(env.tainted.has("query")).toBe(true);
  });

  it("uses a constraint-respecting placeholder when an argument has no default", () => {
    const env = buildStaticEnvironment([{ ...TOP_K, default: null, minimum: 3 }], []);
    expect(env.values.get("top_k")).toBe(3);
  });

  it("evaluates derived variables in dependency order and propagates taint", () => {
    const variables: PipelineVariable[] = [
      { name: "candidates", type: "integer", expression: "doubled + 1" },
      { name: "doubled", type: "integer", expression: "top_k * 2" },
      { name: "constant", type: "integer", value: 7 },
    ];
    const env = buildStaticEnvironment([TOP_K], variables);
    expect(env.values.get("doubled")).toBe(10);
    expect(env.values.get("candidates")).toBe(11);
    expect(env.tainted.has("candidates")).toBe(true);
    expect(env.tainted.has("constant")).toBe(false);
    expect(env.problems.size).toBe(0);
  });

  it("reports cycles as per-variable problems without throwing", () => {
    const variables: PipelineVariable[] = [
      { name: "a", type: "integer", expression: "b + 1" },
      { name: "b", type: "integer", expression: "a + 1" },
    ];
    const env = buildStaticEnvironment([], variables);
    expect(env.problems.get("a")).toMatch(/cycle/);
    expect(env.problems.get("b")).toMatch(/cycle/);
  });

  it("flags a variable with neither value nor expression", () => {
    const env = buildStaticEnvironment([], [{ name: "empty", type: "string" }]);
    expect(env.problems.get("empty")).toMatch(/value or an expression/);
  });
});
