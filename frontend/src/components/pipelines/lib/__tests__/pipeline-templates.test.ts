import { describe, expect, it } from "vitest";

import { makeBackendInfo, makePineconeBackendInfo } from "@/test/fixtures";

import { backendSupportsTemplate, PIPELINE_TEMPLATES, templateById } from "../pipeline-templates";

const BUILD_OPTIONS = {
  indexName: "docs",
  embeddingConnectionId: "conn-1",
  embeddingModel: "text-embed",
  includeBm25: true,
};

const SEMANTIC = "semantic-keyword";
const VECTOR_RETRIEVER = "retriever.vector";
const RERANKER = "reranker.model";
const RETRIEVAL_INPUT = "retrieval.input";

describe("pipeline templates", () => {
  it("offers the semantic, reranked, count, facet, and blank starting points", () => {
    expect(PIPELINE_TEMPLATES.map((template) => template.id)).toEqual([
      "semantic-keyword",
      "reranked",
      "count",
      "facet",
      "blank",
    ]);
  });

  it("blank scaffolds a lone query input with no store dependency", () => {
    const blank = templateById("blank")!;
    expect(blank.needsStore).toBe(false);
    expect(blank.needsEmbedding).toBe(false);
    const definition = blank.build("pgvector", BUILD_OPTIONS);
    expect(definition.nodes.map((node) => node.type)).toEqual([RETRIEVAL_INPUT]);
    // No output terminal: an unconnected required port would fail validation,
    // so the persistable scaffold is input-only.
    expect(definition.edges).toEqual([]);
  });

  it("semantic-keyword scaffolds hybrid retrieval with no reranker", () => {
    const definition = templateById(SEMANTIC)!.build("pgvector", BUILD_OPTIONS);
    const types = definition.nodes.map((node) => node.type);
    expect(types).toContain(VECTOR_RETRIEVER);
    expect(types).toContain("retriever.bm25");
    expect(types).not.toContain(RERANKER);
  });

  it("reranked inserts a reranker before the limit and over-fetches candidates", () => {
    const definition = templateById("reranked")!.build("pgvector", BUILD_OPTIONS);
    const reranker = definition.nodes.find((node) => node.type === RERANKER);
    expect(reranker).toBeDefined();

    // The reranker feeds the limit; the fusion node now feeds the reranker.
    const toLimit = definition.edges.find((edge) => edge.target === "limit-results");
    expect(toLimit?.source).toBe(reranker!.id);
    const fromReranker = definition.edges.find((edge) => edge.source === reranker!.id);
    expect(fromReranker?.target).toBe("limit-results");

    // Retrievers over-fetch so the reranker reorders a wider candidate set.
    const retriever = definition.nodes.find((node) => node.type === VECTOR_RETRIEVER);
    expect(retriever?.config.top_k).toEqual({ $expr: "result_limit * 3" });
  });

  it("reranked on a dense-only backend reranks before the output, no over-fetch", () => {
    const definition = templateById("reranked")!.build("pgvector", {
      ...BUILD_OPTIONS,
      includeBm25: false,
    });
    const reranker = definition.nodes.find((node) => node.type === RERANKER);
    const toOutput = definition.edges.find((edge) => edge.target === "retrieval-output");
    expect(toOutput?.source).toBe(reranker!.id);
    // No limit node to trim, so the retriever keeps its declared depth.
    const retriever = definition.nodes.find((node) => node.type === VECTOR_RETRIEVER);
    expect(retriever?.config.top_k).toEqual({ $expr: "result_limit" });
  });

  it("count scaffolds query → count.bm25 → tool.output over the BM25 sibling index", () => {
    const definition = templateById("count")!.build("pgvector", BUILD_OPTIONS);
    expect(definition.nodes.map((node) => node.type)).toEqual([
      RETRIEVAL_INPUT,
      "count.bm25",
      "tool.output",
    ]);
    const input = definition.nodes[0];
    expect(input.config.tool_name).toBe("count_matches");
    const aggregate = definition.nodes[1];
    expect(aggregate.config.index_name).toBe("docs-bm25");
    expect(aggregate.config.backend).toBe("pgvector");
  });

  it("facet scaffolds a facet.bm25 tool that groups by source", () => {
    const definition = templateById("facet")!.build("pgvector", BUILD_OPTIONS);
    expect(definition.nodes.map((node) => node.type)).toEqual([
      RETRIEVAL_INPUT,
      "facet.bm25",
      "tool.output",
    ]);
    expect(definition.nodes[0].config.tool_name).toBe("facet_matches");
  });

  it("gates count/facet on a backend's aggregate capabilities", () => {
    const pgvector = makeBackendInfo();
    const pinecone = makePineconeBackendInfo();
    const count = templateById("count")!;
    const facet = templateById("facet")!;
    const semantic = templateById(SEMANTIC)!;

    expect(backendSupportsTemplate(count, pgvector)).toBe(true);
    expect(backendSupportsTemplate(count, pinecone)).toBe(false);
    expect(backendSupportsTemplate(facet, pinecone)).toBe(false);
    // Semantic search needs no aggregate capability — every backend qualifies.
    expect(backendSupportsTemplate(semantic, pinecone)).toBe(true);
  });
});
