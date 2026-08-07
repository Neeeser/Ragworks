import { describe, expect, it } from "vitest";

import {
  portRoleName,
  portTooltip,
  portTypeName,
  type PortSide,
  type VocabularyPort,
} from "../port-vocabulary";

const TEXT_ITEMS = "Text items";
const EMBEDDED_ITEMS = "Embedded items";
const RESULTS = "Results";
const QUERY_EMBEDDING = "Query Embedding";

const port = (overrides: Partial<VocabularyPort> & { label: string }): VocabularyPort => ({
  key: "items",
  data_type: "items",
  ...overrides,
});

/**
 * Every port the shipped node registry declares, as `[node, side, label,
 * facets]` — dumped from `default_registry()`. These are the real strings a
 * user reads on the canvas, so the vocabulary is asserted against them rather
 * than against invented ones.
 */
const SHIPPED: Array<{
  node: string;
  side: PortSide;
  port: VocabularyPort;
  type: string;
  role: string | null;
}> = [
  // The same stream under three node-local spellings — the case this exists for.
  {
    node: "embedder.text",
    side: "output",
    port: port({ label: "Items", adds: ["embedding"], preserves: true }),
    type: EMBEDDED_ITEMS,
    role: null,
  },
  {
    node: "indexer.vector",
    side: "input",
    port: port({ label: "Embedded", accepts: ["embedding"] }),
    type: EMBEDDED_ITEMS,
    role: null,
  },
  {
    node: "retriever.vector",
    side: "input",
    port: port({ label: QUERY_EMBEDDING, requires: ["embedding"] }),
    type: EMBEDDED_ITEMS,
    role: QUERY_EMBEDDING,
  },
  // "Results" reaches three different types; none of them gains anything by it.
  {
    node: "fusion.rrf",
    side: "input",
    port: port({ label: RESULTS, requires: ["score"], accepts_many: true }),
    type: "Scored items",
    role: null,
  },
  {
    node: "limit.results",
    side: "input",
    port: port({ label: RESULTS }),
    type: "Items",
    role: null,
  },
  {
    node: "llm.rerank",
    side: "input",
    port: port({ label: RESULTS, requires: ["text"] }),
    type: TEXT_ITEMS,
    role: null,
  },
  // Roles that say something the type cannot.
  {
    node: "chunker.token",
    side: "output",
    port: port({ label: "Chunks", adds: ["text"] }),
    type: TEXT_ITEMS,
    role: "Chunks",
  },
  {
    node: "indexer.vector",
    side: "output",
    port: port({ label: "Indexed", preserves: true }),
    type: "Items",
    role: "Indexed",
  },
  {
    node: "retriever.bm25",
    side: "input",
    port: port({ label: "Query", accepts: ["text"] }),
    type: TEXT_ITEMS,
    role: "Query",
  },
  {
    node: "llm.transform",
    side: "input",
    port: port({ label: "Document", required: false }),
    type: "Items",
    role: "Document",
  },
  {
    node: "llm.generate",
    side: "output",
    port: port({ label: "Generated items", adds: ["text"] }),
    type: TEXT_ITEMS,
    role: "Generated items",
  },
  // Plural/singular and containment, both directions.
  {
    node: "parse.page_images",
    side: "output",
    port: port({ label: "Images", adds: ["image"] }),
    type: "Image items",
    role: null,
  },
  {
    node: "parse.text",
    side: "input",
    port: port({ label: "File", accepts: ["file"] }),
    type: "File items",
    role: null,
  },
  {
    node: "count.bm25",
    side: "output",
    port: port({ label: "Values", data_type: "structured_values" }),
    type: "Structured values",
    role: null,
  },
  {
    node: "retrieval.output",
    side: "output",
    port: port({ label: "Result", data_type: "result" }),
    type: "Result",
    role: null,
  },
];

describe("port vocabulary over the shipped node registry", () => {
  it.each(SHIPPED)("names $node's $side port $type", ({ side, port: subject, type, role }) => {
    expect(portTypeName(subject, side)).toBe(type);
    expect(portRoleName(subject, side)).toBe(role);
  });

  it("reads the same on every node carrying one stream, whatever each calls it", () => {
    // Embedder output, vector Indexer input, and vector Retriever input are one
    // type declared under three node-local labels ("Items", "Embedded", "Query
    // Embedding"). A user comparing two cards must see one name.
    const embedded = SHIPPED.filter((entry) => entry.type === EMBEDDED_ITEMS);
    expect(embedded.map((entry) => entry.port.label)).toEqual([
      "Items",
      "Embedded",
      QUERY_EMBEDDING,
    ]);
    expect(new Set(embedded.map((entry) => portTypeName(entry.port, entry.side)))).toEqual(
      new Set([EMBEDDED_ITEMS]),
    );

    // "Results" spans three unrelated types; none of them may render it as the
    // name of the stream.
    const results = SHIPPED.filter((entry) => entry.port.label === RESULTS);
    expect(results.map((entry) => portTypeName(entry.port, entry.side))).toEqual([
      "Scored items",
      "Items",
      TEXT_ITEMS,
    ]);
    expect(results.every((entry) => portRoleName(entry.port, entry.side) === null)).toBe(true);
  });
});

describe("port tooltips", () => {
  it("states cardinality, requiredness, and the facet contract for an input", () => {
    const subject = port({ label: RESULTS, requires: ["score"], accepts_many: true });

    expect(portTooltip(subject, "input")).toBe(
      "Scored items · accepts many connections · required · needs score on every item",
    );
  });

  it("names an optional single-connection input as such", () => {
    const subject = port({ label: "Document", required: false });

    expect(portTooltip(subject, "input")).toBe(
      "Items · Document · accepts one connection · optional",
    );
  });

  it("says nothing about cardinality on an output, which has none", () => {
    const subject = port({ label: "Chunks", adds: ["text"] });

    expect(portTooltip(subject, "output")).toBe("Text items · Chunks");
  });
});
