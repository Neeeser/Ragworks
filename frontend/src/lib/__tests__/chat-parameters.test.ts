import { describe, expect, it } from "vitest";

import {
  PARAMETER_DEFINITIONS,
  pruneBlockedSamplingKnobs,
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
  sampling: "always",
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

describe("sampling support", () => {
  const knobs = new Set<ModelParameterKey>(["temperature", "top_p", "top_logprobs", "max_tokens"]);

  it("hides sampling knobs a model can never take", () => {
    // o4-mini rejects them on every turn, so a control for them is one the
    // user can only ever get an error from.
    const keys = resolveParameterDefinitions(
      knobs,
      capabilities({ reasoning: "block", reasoning_efforts: ["low"], sampling: "never" }),
    ).map((d) => d.key);
    expect(keys).not.toContain("temperature");
    expect(keys).not.toContain("top_p");
    expect(keys).toContain("max_tokens");
  });

  it("offers them while reasoning is off, with the reason once it is on", () => {
    const caps = capabilities({
      reasoning: "block",
      reasoning_efforts: ["none", "low", "high"],
      sampling: "without_reasoning",
    });
    const offered = resolveParameterDefinitions(knobs, caps, "none").find(
      (d) => d.key === "temperature",
    );
    expect(offered?.unavailableReason).toBeUndefined();

    const blocked = resolveParameterDefinitions(knobs, caps, "high").find(
      (d) => d.key === "temperature",
    );
    expect(blocked?.unavailableReason).toBe("Unavailable while reasoning is active.");
  });

  it("treats an unchosen effort as reasoning-on when the model has no none level", () => {
    const caps = capabilities({
      reasoning: "block",
      reasoning_efforts: ["low", "high"],
      sampling: "without_reasoning",
    });
    const temperature = resolveParameterDefinitions(knobs, caps).find(
      (d) => d.key === "temperature",
    );
    expect(temperature?.unavailableReason).toBeDefined();
  });
});

describe("pruneBlockedSamplingKnobs", () => {
  it("drops knobs the model refuses on this turn", () => {
    const pruned = pruneBlockedSamplingKnobs(
      { temperature: 0.3, top_p: 0.9, max_tokens: 500, reasoning: "high" },
      capabilities({
        reasoning: "block",
        reasoning_efforts: ["none", "high"],
        sampling: "without_reasoning",
      }),
    );
    expect(pruned).toEqual({ max_tokens: 500, reasoning: "high" });
  });

  it("keeps them while reasoning is off", () => {
    const overrides = { temperature: 0.3, reasoning: "none" };
    expect(
      pruneBlockedSamplingKnobs(
        overrides,
        capabilities({
          reasoning: "block",
          reasoning_efforts: ["none", "high"],
          sampling: "without_reasoning",
        }),
      ),
    ).toBe(overrides);
  });

  it("drops them unconditionally on a never model", () => {
    expect(
      pruneBlockedSamplingKnobs({ temperature: 0.3 }, capabilities({ sampling: "never" })),
    ).toEqual({});
  });
});
