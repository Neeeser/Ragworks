"use client";

import { describe, expect, it } from "vitest";

import {
  buildPipelineConfigFields,
  coerceFieldValue,
  formatConfigValue,
  getInputValue,
} from "@/components/pipelines/lib/pipeline-config";

import type { PipelineConfigField } from "@/components/pipelines/lib/pipeline-config";

describe("pipeline-config", () => {
  it("returns empty fields for undefined schema", () => {
    expect(buildPipelineConfigFields()).toEqual([]);
  });

  it("builds fields for enums and basic types", () => {
    const fields = buildPipelineConfigFields({
      properties: {
        mode: { type: "string", enum: ["FAST", "slow"] },
        count: { type: "integer", minimum: 1, default: 2 },
        enabled: { type: "boolean" },
        meta: { type: "object" },
      },
      required: ["count"],
    });

    const types = fields.map((field) => field.input);
    expect(types).toEqual(["select", "integer", "boolean", "json"]);
    expect(fields[0]?.options?.[0]?.label).toBe("FAST");
  });

  it("captures field metadata for descriptions and placeholders", () => {
    const fields = buildPipelineConfigFields({
      properties: {
        threshold: {
          type: "number",
          minimum: 0.1,
          maximum: 1,
          multipleOf: 0.05,
          description: "Threshold value",
          examples: ["0.5"],
        },
      },
    });

    expect(fields[0]?.description).toBe("Threshold value");
    expect(fields[0]?.min).toBe(0.1);
    expect(fields[0]?.max).toBe(1);
    expect(fields[0]?.step).toBe(0.05);
    expect(fields[0]?.placeholder).toBe("0.5");
  });

  it("resolves refs and nullable schemas", () => {
    const fields = buildPipelineConfigFields({
      $defs: {
        Shared: { type: ["string", "null"], title: "Shared" },
      },
      properties: {
        viaRef: { $ref: "#/$defs/Shared" },
        viaAllOf: { allOf: [{ type: "number" }] },
        viaAnyOf: { anyOf: [{ type: "null" }, { type: "string" }] },
      },
    });

    const labels = fields.map((field) => field.label);
    expect(labels).toContain("Shared");
    expect(fields.some((field) => field.nullable)).toBe(true);
  });

  it("handles empty refs and nullable variants", () => {
    const fields = buildPipelineConfigFields({
      definitions: {
        Ref: { type: ["null"], title: "Ref" },
      },
      properties: {
        emptyRef: { $ref: "#/definitions/" },
        nullableAny: { anyOf: [{ type: "null" }, { type: ["string", "null"] }] },
        unknownType: { type: 123 },
      },
    });

    expect(fields.some((field) => field.key === "emptyRef")).toBe(true);
    expect(fields.some((field) => field.key === "nullableAny" && field.nullable)).toBe(true);
    expect(fields.some((field) => field.key === "unknownType")).toBe(true);
  });

  it("formats config values", () => {
    // Null/undefined render as an em dash (unified with the previous PipelineNode-local
    // formatConfigValue, which rendered "null"); "" is no longer a valid rendering.
    expect(formatConfigValue(null)).toBe("—");
    expect(formatConfigValue("text")).toBe("text");
    expect(formatConfigValue(12)).toBe("12");
    expect(formatConfigValue(true)).toBe("true");
    expect(formatConfigValue({ a: 1 })).toBe('{"a":1}');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatConfigValue(circular)).toBe("[object Object]");
  });

  it("keeps schemas when refs are missing and selects non-null variants", () => {
    const fields = buildPipelineConfigFields({
      $defs: {},
      properties: {
        missingRef: { $ref: "#/$defs/Missing" },
        pickOne: { oneOf: [{ type: "null" }, { type: "string", title: "Pick me" }] },
        nullableChoice: { anyOf: [{ type: ["string", "null"] }, { type: "number" }] },
        nullOnly: { type: ["null"] },
      },
    });

    expect(fields.some((field) => field.key === "missingRef")).toBe(true);
    expect(fields.some((field) => field.label === "Pick me")).toBe(true);
    expect(fields.some((field) => field.key === "nullableChoice" && field.nullable)).toBe(true);
    expect(fields.some((field) => field.key === "nullOnly" && field.nullable)).toBe(true);
  });

  const numberField: PipelineConfigField = {
    key: "count",
    label: "Count",
    input: "number",
    nullable: false,
    required: false,
    staticOnly: false,
    exprType: "number",
  };
  const integerField: PipelineConfigField = { ...numberField, key: "n", input: "integer" };
  const booleanField: PipelineConfigField = { ...numberField, key: "flag", input: "boolean" };
  const nullableTextField: PipelineConfigField = {
    ...numberField,
    key: "note",
    input: "text",
    nullable: true,
  };
  const textField: PipelineConfigField = { ...numberField, key: "label", input: "text" };

  it("reads input values with schema default fallback", () => {
    expect(getInputValue(numberField, { count: 5 })).toBe(5);
    expect(getInputValue(numberField, {})).toBe("");
    expect(getInputValue({ ...numberField, defaultValue: 2 }, {})).toBe(2);
  });

  it("coerces raw control values per field kind", () => {
    expect(coerceFieldValue(numberField, "1.5")).toBe(1.5);
    expect(coerceFieldValue(numberField, "")).toBeUndefined();
    expect(coerceFieldValue(numberField, "NaN")).toBeUndefined();
    expect(coerceFieldValue(integerField, "3.9")).toBe(3);
    expect(coerceFieldValue(booleanField, true)).toBe(true);
    expect(coerceFieldValue(booleanField, false)).toBe(false);
    expect(coerceFieldValue(nullableTextField, "")).toBeUndefined();
    expect(coerceFieldValue(textField, "")).toBe("");
    expect(coerceFieldValue(textField, "hello")).toBe("hello");
  });
});
