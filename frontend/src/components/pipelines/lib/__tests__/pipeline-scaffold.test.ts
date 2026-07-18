import { describe, expect, it } from "vitest";

import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";

describe("buildDefaultDefinition", () => {
  it("declares the result_limit input variable, mirroring the backend scaffold", () => {
    // The backend scaffold (app/pipelines/defaults.py) declares result_limit as an
    // input-source variable accepted by retrieval.input, so search controls
    // and the chat tool schema see the same contract; wizard-created
    // pipelines must not silently declare nothing.
    const definition = buildDefaultDefinition("retrieval", "pgvector");
    const input = definition.nodes.find((node) => node.type === "retrieval.input");
    expect(input?.config).toEqual({ arguments: ["result_limit"] });
    expect(definition.variables).toEqual([
      {
        name: "result_limit",
        type: "integer",
        source: "input",
        description: "Maximum number of results to return.",
        value: 5,
        minimum: 1,
        maximum: 10,
        expose_to_llm: true,
      },
    ]);
  });

  it("scaffolds the hybrid ranking row: fusion never cuts, Result Limit does", () => {
    const definition = buildDefaultDefinition("retrieval", "pgvector", { includeBm25: true });
    const fusion = definition.nodes.find((node) => node.type === "fusion.rrf");
    const limit = definition.nodes.find((node) => node.type === "limit.results");
    expect(fusion?.config).toEqual({});
    expect(limit?.name).toBe("Result Limit");
    expect(limit?.config).toEqual({ max_results: { $expr: "result_limit" } });
    // Retrievers carry their fetch depth explicitly — no invisible fallback.
    for (const type of ["retriever.vector", "retriever.bm25"]) {
      const retriever = definition.nodes.find((node) => node.type === type);
      expect(retriever?.config).toMatchObject({ top_k: { $expr: "result_limit" } });
    }
    expect(
      definition.edges.some((edge) => edge.source === fusion?.id && edge.target === limit?.id),
    ).toBe(true);
    expect(
      definition.edges.some(
        (edge) => edge.source === limit?.id && edge.target === "retrieval-output",
      ),
    ).toBe(true);
  });

  it("keeps the ingestion input undeclared", () => {
    const definition = buildDefaultDefinition("ingestion", "pgvector");
    const input = definition.nodes.find((node) => node.type === "ingestion.input");
    expect(input?.config).toEqual({});
  });
});
