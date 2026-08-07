import { describe, expect, it } from "vitest";

import {
  filterNodeCatalog,
  firstSentence,
  instanceLabelsByType,
} from "@/components/pipelines/lib/node-library-filter";
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

const RETRIEVER_TYPE = "retriever.vector";
/** What the default graphs name this node; the catalog entry is just "Retriever". */
const SEMANTIC_RETRIEVER = "Semantic Retriever";

const retrieverCatalog = [
  {
    family: "retriever" as const,
    specs: [makeNodeSpec({ type: RETRIEVER_TYPE, label: "Retriever" })],
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

  it("finds a node by the label its instance carries on the canvas", () => {
    const result = filterNodeCatalog(
      retrieverCatalog,
      null,
      SEMANTIC_RETRIEVER,
      instanceLabelsByType([{ nodeType: RETRIEVER_TYPE, label: SEMANTIC_RETRIEVER }]),
    );
    expect(result[0]?.specs.map((spec) => spec.label)).toEqual(["Retriever"]);
  });

  it("finds a node by a known alias with nothing on the canvas", () => {
    const result = filterNodeCatalog(retrieverCatalog, null, "semantic retriever");
    expect(result[0]?.specs.map((spec) => spec.label)).toEqual(["Retriever"]);
  });

  it("matches tokens in any order", () => {
    expect(filterNodeCatalog(catalog, null, "chunker token")[0]?.specs).toHaveLength(1);
  });
});

describe("instanceLabelsByType", () => {
  it("collects each type's distinct canvas labels", () => {
    expect(
      instanceLabelsByType([
        { nodeType: RETRIEVER_TYPE, label: SEMANTIC_RETRIEVER },
        { nodeType: RETRIEVER_TYPE, label: SEMANTIC_RETRIEVER },
        { nodeType: RETRIEVER_TYPE, label: "Backup Retriever" },
      ]),
    ).toEqual({ [RETRIEVER_TYPE]: [SEMANTIC_RETRIEVER, "Backup Retriever"] });
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
