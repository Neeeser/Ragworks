import { describe, expect, it } from "vitest";

import { PARAMETER_DEFINITIONS, resolveParameterDefinitions } from "@/lib/chat-parameters";

import type { ModelParameterKey } from "@/lib/chat-parameters";

describe("chat-parameters", () => {
  it("exposes parameter definitions", () => {
    expect(PARAMETER_DEFINITIONS.length).toBeGreaterThan(0);
    expect(PARAMETER_DEFINITIONS[0]?.key).toBe("temperature");
  });
});

describe("resolveParameterDefinitions", () => {
  const supported = new Set<ModelParameterKey>(["temperature", "reasoning"]);

  it("filters to the model's supported set", () => {
    const keys = resolveParameterDefinitions(supported).map((d) => d.key);
    expect(keys).toContain("temperature");
    expect(keys).not.toContain("top_p");
  });

  it("always includes extra_body, even when the model supports nothing", () => {
    const keys = resolveParameterDefinitions(new Set()).map((d) => d.key);
    expect(keys).toEqual(["extra_body"]);
  });

  it("swaps in the model's published reasoning-effort levels", () => {
    const reasoning = resolveParameterDefinitions(supported, ["none", "low", "xhigh"]).find(
      (d) => d.key === "reasoning",
    );
    expect(reasoning?.options).toEqual([
      { label: "Model default", value: "" },
      { label: "None", value: "none" },
      { label: "Low", value: "low" },
      { label: "Extra high", value: "xhigh" },
    ]);
  });

  it("keeps the generic effort list when the provider publishes none", () => {
    const reasoning = resolveParameterDefinitions(supported).find((d) => d.key === "reasoning");
    expect(reasoning?.options?.some((o) => o.value === "medium")).toBe(true);
  });
});
