import { describe, expect, it } from "vitest";

import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";

describe("buildDefaultDefinition", () => {
  it("declares the historical top_k input variable, mirroring the backend scaffold", () => {
    // The backend scaffold (app/pipelines/defaults.py) declares top_k as an
    // input-source variable accepted by retrieval.input, so search controls
    // and the chat tool schema see the same contract; wizard-created
    // pipelines must not silently declare nothing.
    const definition = buildDefaultDefinition("retrieval", "pgvector");
    const input = definition.nodes.find((node) => node.type === "retrieval.input");
    expect(input?.config).toEqual({ arguments: ["top_k"] });
    expect(definition.variables).toEqual([
      {
        name: "top_k",
        type: "integer",
        source: "input",
        description: "How many chunks to retrieve.",
        value: 5,
        minimum: 1,
        maximum: 10,
        expose_to_llm: true,
      },
    ]);
  });

  it("scaffolds the hybrid ranking row: fusion never cuts, Top-N does", () => {
    const definition = buildDefaultDefinition("retrieval", "pgvector", { includeBm25: true });
    const fusion = definition.nodes.find((node) => node.type === "fusion.rrf");
    const limit = definition.nodes.find((node) => node.type === "limit.top_n");
    expect(fusion?.config).toEqual({});
    expect(limit?.config).toEqual({ top_n: { $expr: "top_k" } });
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
