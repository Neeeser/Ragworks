import { describe, expect, it } from "vitest";

import { filterNodeCatalog, firstSentence } from "@/components/pipelines/lib/node-library-filter";
import { makeNodeSpec } from "@/test/fixtures";

const catalog = [
  {
    family: "chunker" as const,
    specs: [
      makeNodeSpec({ type: "chunker.token", label: "Token Chunker" }),
      makeNodeSpec({ type: "chunker.sentence", label: "Sentence Chunker" }),
    ],
  },
  {
    family: "llm" as const,
    specs: [
      makeNodeSpec({
        type: "llm.transform",
        label: "LLM Transform",
        presets: [
          { id: "summarize", label: "Summarize", description: "Summarizes.", config: {} },
          { id: "hyde", label: "HyDE", description: "Hypothetical documents.", config: {} },
        ],
      }),
    ],
  },
];

describe("filterNodeCatalog", () => {
  it("narrows to the selected family when not searching", () => {
    const result = filterNodeCatalog(catalog, "chunker", "");
    expect(result.map((group) => group.family)).toEqual(["chunker"]);
  });

  it("search ignores the family filter so no match hides", () => {
    const result = filterNodeCatalog(catalog, "chunker", "transform");
    expect(result.map((group) => group.family)).toEqual(["llm"]);
  });

  it("matches on the node type id", () => {
    const result = filterNodeCatalog(catalog, null, "chunker.sentence");
    expect(result[0]?.specs.map((spec) => spec.label)).toEqual(["Sentence Chunker"]);
  });

  it("keeps a shell with only its matching presets when just a preset matches", () => {
    const result = filterNodeCatalog(catalog, null, "hyde");
    expect(result).toHaveLength(1);
    const spec = result[0]?.specs[0];
    expect(spec?.label).toBe("LLM Transform");
    expect(spec?.presets?.map((preset) => preset.id)).toEqual(["hyde"]);
  });

  it("keeps the full preset list when the shell itself matches", () => {
    const result = filterNodeCatalog(catalog, null, "transform");
    expect(result[0]?.specs[0]?.presets).toHaveLength(2);
  });

  it("drops groups with no matches", () => {
    expect(filterNodeCatalog(catalog, null, "nothing-matches")).toEqual([]);
  });
});

describe("firstSentence", () => {
  it("cuts at the first sentence boundary", () => {
    expect(firstSentence("Splits text. Keeps metadata.")).toBe("Splits text.");
  });

  it("returns the whole text when there is no boundary", () => {
    expect(firstSentence("Splits text")).toBe("Splits text");
  });
});
