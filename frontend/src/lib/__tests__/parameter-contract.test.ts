/**
 * Pin the frontend side of the shared chat-parameter contract. The same
 * `tests/assets/chat_parameter_contract.json` is asserted by pytest on the
 * backend, so a key added on one side only fails a gate instead of being
 * silently dropped — Pydantic ignores unknown keys, and this panel renders
 * only keys it has a definition for.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PARAMETER_DEFINITIONS,
  SAMPLING_KNOBS,
  resolveParameterDefinitions,
} from "@/lib/chat-parameters";

import type { ModelParameterKey } from "@/lib/chat-parameters";

const CONTRACT_PATH = path.resolve(process.cwd(), "../tests/assets/chat_parameter_contract.json");
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as {
  sampling_parameters: string[];
  capability_controls: string[];
  passthrough_parameter: string;
  reasoning_efforts: string[];
  reasoning_styles: string[];
  sampling_support: string[];
  sampling_knobs: string[];
};

describe("chat parameter contract", () => {
  it("renders a control for every key the wire contract carries", () => {
    const rendered = PARAMETER_DEFINITIONS.map((definition) => definition.key).sort();
    const expected = [
      ...contract.sampling_parameters,
      ...contract.capability_controls,
      contract.passthrough_parameter,
    ].sort();
    expect(rendered).toEqual(expected);
  });

  it("offers only effort levels the contract allows", () => {
    const efforts = contract.reasoning_efforts;
    const reasoning = resolveParameterDefinitions(new Set<ModelParameterKey>(), {
      tools: false,
      reasoning: "block",
      reasoning_efforts: efforts,
      sampling: "always",
    }).find((definition) => definition.key === "reasoning");
    const offered = (reasoning?.options ?? [])
      .map((option) => option.value)
      .filter((value) => value !== "");
    expect(offered).toEqual(efforts);
  });

  it("gates exactly the sampling knobs the contract names", () => {
    expect([...SAMPLING_KNOBS]).toEqual(contract.sampling_knobs);
  });

  it("hides every contract sampling knob on a model that never takes them", () => {
    const keys = resolveParameterDefinitions(
      new Set(contract.sampling_knobs as ModelParameterKey[]),
      { tools: false, reasoning: "none", reasoning_efforts: [], sampling: "never" },
    ).map((definition) => definition.key);
    for (const knob of contract.sampling_knobs) {
      expect(keys).not.toContain(knob);
    }
  });

  it("treats every contract reasoning style as a known value", () => {
    for (const style of contract.reasoning_styles) {
      const definitions = resolveParameterDefinitions(new Set<ModelParameterKey>(), {
        tools: false,
        reasoning: style as "none" | "block" | "include_flag",
        reasoning_efforts: [],
        sampling: "always",
      });
      const hasReasoningControl = definitions.some((definition) => definition.key === "reasoning");
      // Only "none" hides the control; every positive style shows one.
      expect(hasReasoningControl).toBe(style !== "none");
    }
  });
});
