import { describe, expect, it } from "vitest";

import { makeCatalogModel } from "@/test/fixtures";

import {
  allowedTargets,
  emptyOutputField,
  outputFieldsFromConfig,
  structuredOutputCapable,
} from "../llm";
import { presetizedSpec } from "../presets";

import type { NodeSpec } from "@/lib/types";

const TRANSFORM_TYPE = "llm.transform";

describe("structuredOutputCapable", () => {
  it("accepts models advertising response_format", () => {
    const model = makeCatalogModel({ supported_parameters: ["response_format"] });
    expect(structuredOutputCapable(model)).toBe(true);
  });

  it("accepts models advertising tools", () => {
    const model = makeCatalogModel({
      supported_parameters: [],
      capabilities: { tools: true, reasoning: "none", reasoning_efforts: [], sampling: "always" },
    });
    expect(structuredOutputCapable(model)).toBe(true);
  });

  it("rejects models advertising neither", () => {
    const model = makeCatalogModel({
      supported_parameters: ["temperature"],
      capabilities: { tools: false, reasoning: "none", reasoning_efforts: [], sampling: "always" },
    });
    expect(structuredOutputCapable(model)).toBe(false);
  });
});

describe("outputFieldsFromConfig", () => {
  it("round-trips well-formed fields and drops malformed entries", () => {
    const fields = outputFieldsFromConfig({
      output_fields: [
        {
          name: "topic",
          type: "string",
          description: "d",
          target: { kind: "metadata", key: "topic" },
        },
        { name: "broken" }, // no target — dropped
        "not an object",
      ],
    });
    expect(fields).toEqual([
      {
        name: "topic",
        type: "string",
        description: "d",
        target: { kind: "metadata", key: "topic" },
      },
    ]);
  });
});

describe("allowedTargets / emptyOutputField", () => {
  it("constrains targets per shell and seeds a matching field", () => {
    expect(allowedTargets(TRANSFORM_TYPE)).toEqual(["metadata", "text"]);
    expect(allowedTargets("llm.rerank")).toEqual(["score", "metadata"]);
    expect(allowedTargets("llm.generate")).toEqual(["items"]);
    expect(emptyOutputField("llm.rerank").target.kind).toBe("score");
    expect(emptyOutputField("llm.generate").type).toBe("string_list");
  });
});

describe("presetizedSpec", () => {
  it("merges the preset config over defaults and keeps the type id", () => {
    const spec = {
      type: TRANSFORM_TYPE,
      label: "LLM Transform",
      category: "llm",
      description: "base",
      example: "e",
      input_ports: [],
      output_ports: [],
      config_schema: {},
      default_config: { temperature: 0, prompt: "" },
      hidden: false,
      supported_backends: null,
      presets: [],
    } satisfies NodeSpec;
    const preset = {
      id: "contextual-retrieval",
      label: "Contextual Retrieval",
      description: "p",
      config: { prompt: "situate {text}" },
    };
    const merged = presetizedSpec(spec, preset);
    expect(merged.type).toBe(TRANSFORM_TYPE);
    expect(merged.label).toBe("Contextual Retrieval");
    expect(merged.default_config).toEqual({ temperature: 0, prompt: "situate {text}" });
  });
});
