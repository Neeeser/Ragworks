import { describe, expect, it } from "vitest";

import {
  resolveNodeDescription,
  resolveNodeExample,
} from "@/components/pipelines/lib/node-content";

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
      hidden: false,
      supported_backends: null,
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
      hidden: false,
      supported_backends: null,
    };
    expect(resolveNodeDescription(spec)).toBe("Custom description");
    expect(resolveNodeExample(spec)).toBeUndefined();
  });

  it("describes the provider-backed reranker without local or truncation settings", () => {
    const spec: NodeSpec = {
      type: "reranker.model",
      label: "Reranker",
      category: "retrieval",
      description: "Fallback description",
      example: "",
      input_ports: [],
      output_ports: [],
      config_schema: {},
      default_config: {},
      hidden: false,
      supported_backends: null,
    };

    expect(resolveNodeDescription(spec)).toContain("configured provider connection");
    expect(resolveNodeDescription(spec)).not.toMatch(/enabled|top[_ ]?[nk]|limit/i);
    expect(resolveNodeExample(spec)).toEqual(
      expect.objectContaining({ input: expect.any(String), output: expect.any(String) }),
    );
  });
});
