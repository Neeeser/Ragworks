import { describe, expect, it } from "vitest";

import {
  PARAMETER_DEFINITIONS,
  pruneUnsupportedEffort,
  resolveParameterDefinitions,
} from "@/lib/chat-parameters";

import type { ModelParameterKey } from "@/lib/chat-parameters";
import type { ChatCapabilities } from "@/lib/types";

describe("chat-parameters", () => {
  it("exposes parameter definitions", () => {
    expect(PARAMETER_DEFINITIONS.length).toBeGreaterThan(0);
    expect(PARAMETER_DEFINITIONS[0]?.key).toBe("temperature");
  });
});

const capabilities = (overrides: Partial<ChatCapabilities> = {}): ChatCapabilities => ({
  tools: false,
  reasoning: "none",
  reasoning_efforts: [],
  ...overrides,
});

describe("resolveParameterDefinitions", () => {
  const supported = new Set<ModelParameterKey>(["temperature"]);

  it("filters to the model's supported set", () => {
    const keys = resolveParameterDefinitions(supported).map((d) => d.key);
    expect(keys).toContain("temperature");
    expect(keys).not.toContain("top_p");
  });

  it("always includes extra_body, even when the model supports nothing", () => {
    const keys = resolveParameterDefinitions(new Set()).map((d) => d.key);
    expect(keys).toEqual(["extra_body"]);
  });

  it("hides the reasoning control on a model that cannot reason", () => {
    const keys = resolveParameterDefinitions(supported, capabilities()).map((d) => d.key);
    expect(keys).not.toContain("reasoning");
  });

  it("offers only the effort levels the provider published", () => {
    const reasoning = resolveParameterDefinitions(
      supported,
      capabilities({ reasoning: "block", reasoning_efforts: ["none", "low", "xhigh"] }),
    ).find((d) => d.key === "reasoning");
    expect(reasoning?.options).toEqual([
      { label: "Model default", value: "" },
      { label: "None", value: "none" },
      { label: "Low", value: "low" },
      { label: "Extra high", value: "xhigh" },
    ]);
  });

  it("renders an on/off control when the provider publishes no levels", () => {
    const reasoning = resolveParameterDefinitions(
      supported,
      capabilities({ reasoning: "block" }),
    ).find((d) => d.key === "reasoning");
    expect(reasoning?.input).toBe("boolean");
    expect(reasoning?.options).toBeUndefined();
  });
});

describe("pruneUnsupportedEffort", () => {
  it("drops an effort the target model does not publish", () => {
    const pruned = pruneUnsupportedEffort(
      { reasoning: "xhigh", temperature: 0.5 },
      capabilities({ reasoning: "block", reasoning_efforts: ["low", "medium", "high"] }),
    );
    expect(pruned).toEqual({ temperature: 0.5 });
  });

  it("keeps an effort the model publishes", () => {
    const overrides = { reasoning: "high" };
    expect(
      pruneUnsupportedEffort(
        overrides,
        capabilities({ reasoning: "block", reasoning_efforts: ["low", "high"] }),
      ),
    ).toBe(overrides);
  });

  it("leaves the value alone when the provider publishes no levels", () => {
    const overrides = { reasoning: "high" };
    expect(pruneUnsupportedEffort(overrides, capabilities({ reasoning: "block" }))).toBe(overrides);
  });
});
