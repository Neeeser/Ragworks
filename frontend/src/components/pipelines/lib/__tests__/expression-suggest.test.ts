import { describe, expect, it } from "vitest";

import {
  applySuggestion,
  buildSuggestions,
  caretToken,
  filterSuggestions,
} from "../expression-suggest";
import { buildStaticEnvironment } from "../variable-env";

import type { PipelineVariable } from "@/lib/types";

const VARIABLES: PipelineVariable[] = [
  { name: "top_k", type: "integer", source: "input", value: 5 },
  { name: "mode", type: "enum", source: "input", value: "fast", choices: ["fast", "deep"] },
  { name: "pool", type: "integer", expression: "top_k * 2" },
  { name: "label", type: "string", value: "docs" },
];

const env = buildStaticEnvironment(VARIABLES);

describe("buildSuggestions", () => {
  it("offers every variable with badge/type/preview, then the functions", () => {
    const suggestions = buildSuggestions(env);
    const names = suggestions.map((suggestion) => suggestion.name);
    expect(names).toContain("top_k");
    expect(names).toContain("pool");
    expect(names.indexOf("max")).toBeGreaterThan(names.indexOf("pool"));
    const topK = suggestions.find((suggestion) => suggestion.name === "top_k");
    expect(topK).toMatchObject({ badge: "input", detail: "integer", preview: "5" });
    const max = suggestions.find((suggestion) => suggestion.name === "max");
    expect(max).toMatchObject({ kind: "function", insertText: "max()", caretOffset: 4 });
  });

  it("ranks matching-type variables first when an expected type is set", () => {
    const suggestions = buildSuggestions(env, { expectedType: "integer" });
    const variables = suggestions.filter((suggestion) => suggestion.kind === "variable");
    const firstString = variables.findIndex((suggestion) => suggestion.detail === "string");
    const lastInteger = variables
      .map((suggestion, index) => (suggestion.detail === "integer" ? index : -1))
      .filter((index) => index >= 0)
      .pop();
    expect(lastInteger).toBeLessThan(firstString);
  });

  it("excludes tainted names on static-only fields", () => {
    const suggestions = buildSuggestions(env, { staticOnly: true });
    const names = suggestions.map((suggestion) => suggestion.name);
    expect(names).not.toContain("top_k");
    expect(names).not.toContain("pool"); // derived from caller input
    expect(names).not.toContain("query");
    expect(names).toContain("label");
  });
});

describe("caretToken", () => {
  it("finds the identifier token around the caret", () => {
    expect(caretToken("max(top_k)", 7)).toEqual({ start: 4, end: 9, text: "top_k" });
  });

  it("returns an empty token between non-identifier characters", () => {
    expect(caretToken("top_k * 2", 7)).toEqual({ start: 7, end: 7, text: "" });
  });

  it("never treats a number literal as an identifier", () => {
    expect(caretToken("top_k * 42", 10)).toEqual({ start: 10, end: 10, text: "" });
  });
});

describe("filterSuggestions", () => {
  it("puts prefix matches before substring matches", () => {
    const suggestions = buildSuggestions(env);
    const filtered = filterSuggestions(suggestions, "mo");
    expect(filtered[0]?.name).toBe("mode");
    expect(filtered.every((suggestion) => suggestion.name.includes("mo"))).toBe(true);
  });

  it("keeps everything on an empty token", () => {
    const suggestions = buildSuggestions(env);
    expect(filterSuggestions(suggestions, "")).toHaveLength(suggestions.length);
  });
});

describe("applySuggestion", () => {
  it("replaces the caret token and reports the new caret", () => {
    const suggestions = buildSuggestions(env);
    const topK = suggestions.find((suggestion) => suggestion.name === "top_k");
    const applied = applySuggestion("max(to, 4)", { start: 4, end: 6, text: "to" }, topK!);
    expect(applied).toEqual({ source: "max(top_k, 4)", caret: 9 });
  });

  it("lands the caret inside a function's parentheses", () => {
    const suggestions = buildSuggestions(env);
    const clamp = suggestions.find((suggestion) => suggestion.name === "clamp");
    const applied = applySuggestion("cla", { start: 0, end: 3, text: "cla" }, clamp!);
    expect(applied.source).toBe("clamp()");
    expect(applied.caret).toBe(6);
  });
});
