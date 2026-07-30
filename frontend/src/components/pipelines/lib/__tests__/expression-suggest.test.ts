import { describe, expect, it } from "vitest";

import {
  applySuggestion,
  buildSuggestions,
  caretToken,
  filterSuggestions,
} from "../expression-suggest";
import { buildStaticEnvironment } from "../variable-env";

import type { ExprType } from "@/lib/expressions";
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

  it("offers only variables an expected-type field can hold", () => {
    // Ranking a string below an integer still left it one keystroke from a
    // guaranteed type error; an unusable suggestion is worse than none.
    const variables = buildSuggestions(env, { expectedType: "integer" }).filter(
      (suggestion) => suggestion.kind === "variable",
    );

    expect(variables.every((suggestion) => suggestion.detail === "integer")).toBe(true);
    expect(variables.map((suggestion) => suggestion.name)).toContain("top_k");
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

const SELF_CHUNK_SIZE = "self.chunk_size";

describe("the self scope in suggestions", () => {
  const selfFields = new Map<string, ExprType>([
    ["chunk_size", "integer"],
    ["chunk_overlap", "integer"],
  ]);

  it("offers a node's other config fields, qualified, ahead of variables", () => {
    const suggestions = buildSuggestions(env, { selfFields, selfFieldKey: "chunk_overlap" });

    expect(suggestions[0].name).toBe(SELF_CHUNK_SIZE);
    expect(suggestions[0].kind).toBe("field");
  });

  it("hides siblings the field cannot hold, rather than offering a type error", () => {
    const mixed = new Map<string, ExprType>([
      ["chunk_size", "integer"],
      ["tokenizer", "string"],
    ]);

    const names = buildSuggestions(env, {
      selfFields: mixed,
      selfFieldKey: "chunk_overlap",
      expectedType: "integer",
    }).map((suggestion) => suggestion.name);

    expect(names).toContain(SELF_CHUNK_SIZE);
    expect(names).not.toContain("self.tokenizer");
  });

  it("shows what each sibling resolves to, so a row can be chosen on its value", () => {
    const suggestions = buildSuggestions(env, {
      selfFields,
      selfValues: new Map<string, unknown>([["chunk_size", 512]]),
      selfFieldKey: "chunk_overlap",
    });

    expect(suggestions.find((s) => s.name === SELF_CHUNK_SIZE)?.preview).toBe("512");
  });

  it("hides a sibling with no value, which would type-check then fail to resolve", () => {
    const names = buildSuggestions(env, {
      selfFields: new Map<string, ExprType>([
        ["chunk_size", "integer"],
        ["hf_model_id", "string"],
      ]),
      // hf_model_id is null on the node, so it has no entry here.
      selfValues: new Map<string, unknown>([["chunk_size", 512]]),
      selfFieldKey: "chunk_overlap",
    }).map((suggestion) => suggestion.name);

    expect(names).toContain(SELF_CHUNK_SIZE);
    expect(names).not.toContain("self.hf_model_id");
  });

  it("hides variables the field cannot hold", () => {
    const names = buildSuggestions(env, { expectedType: "integer" }).map((s) => s.name);

    expect(names).toContain("top_k");
    expect(names).not.toContain("label");
  });

  it("never offers the field being edited, the shortest possible cycle", () => {
    const suggestions = buildSuggestions(env, { selfFields, selfFieldKey: "chunk_overlap" });

    expect(suggestions.map((s) => s.name)).not.toContain("self.chunk_overlap");
  });

  it("absorbs a typed self. qualifier so acceptance does not double it", () => {
    const source = "self.ch";
    const token = caretToken(source, source.length);

    const applied = applySuggestion(source, token, {
      name: SELF_CHUNK_SIZE,
      kind: "field",
      badge: "field",
      detail: "integer",
      preview: null,
      insertText: SELF_CHUNK_SIZE,
      caretOffset: SELF_CHUNK_SIZE.length,
    });

    expect(applied.source).toBe(SELF_CHUNK_SIZE);
  });
});
