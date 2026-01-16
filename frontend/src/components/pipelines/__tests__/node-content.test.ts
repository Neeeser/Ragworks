import { describe, expect, it } from "vitest";

import { resolveNodeDescription, resolveNodeExample } from "@/components/pipelines/node-content";

import type { NodeSpec } from "@/lib/types";

describe("node-content", () => {
  it("prefers curated descriptions and examples", () => {
    const spec: NodeSpec = {
      type: "ingestion.input",
      label: "Input",
      category: "ingestion",
      description: "Fallback description",
      example: "Fallback example",
      input_ports: [],
      output_ports: [],
      config_schema: {},
      default_config: {},
    };
    const description = resolveNodeDescription(spec);
    const example = resolveNodeExample(spec);
    expect(description).toContain("Starts ingestion");
    expect(example).toEqual(
      expect.objectContaining({
        input: expect.any(String),
        output: expect.any(String),
      }),
    );
  });

  it("falls back to spec descriptions when no curated entry exists", () => {
    const spec: NodeSpec = {
      type: "custom.node",
      label: "Custom",
      category: "utility",
      description: "Custom description",
      example: "Custom example",
      input_ports: [],
      output_ports: [],
      config_schema: {},
      default_config: {},
    };
    expect(resolveNodeDescription(spec)).toBe("Custom description");
    expect(resolveNodeExample(spec)).toBeUndefined();
  });
});
