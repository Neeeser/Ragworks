import { describe, expect, it } from "vitest";

import { bestChunkFor, goldDocJourney, goldHitCount } from "@/components/evals/lib/journey";
import { makeEvalRunItem, makeFunnelStage } from "@/test/fixtures";

const STAGES = [
  makeFunnelStage({ node_id: "ingestion", node_type: "ingestion", label: "Ingestion coverage" }),
  makeFunnelStage({
    node_id: "bm25",
    node_type: "retriever.pgvector.bm25",
    label: "BM25 Retriever",
  }),
  makeFunnelStage({
    node_id: "dense",
    node_type: "retriever.pgvector",
    label: "Semantic Retriever",
  }),
  makeFunnelStage({ node_id: "fuse", node_type: "fusion.rrf", label: "RRF Fusion" }),
  makeFunnelStage({ node_id: "out", node_type: "retrieval.output", label: "Retrieval Output" }),
];

describe("goldDocJourney", () => {
  it("marks presence per stage with node-local ranks and no drop when retrieved", () => {
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA"],
      retrieved_document_ids: ["docB", "docA"],
      per_node_funnel: [
        { node_id: "ingestion", document_ids: ["docA"] },
        { node_id: "bm25", document_ids: ["docB"] },
        { node_id: "dense", document_ids: ["docA", "docB"] },
        { node_id: "fuse", document_ids: ["docB", "docA"] },
        { node_id: "out", document_ids: ["docB", "docA"] },
      ],
    });
    const journey = goldDocJourney("docA", STAGES, item);
    expect(journey.finalRank).toBe(2);
    expect(journey.droppedAt).toBeNull();
    expect(journey.steps.map((step) => step.present)).toEqual([true, false, true, true, true]);
    expect(journey.steps.map((step) => step.rank)).toEqual([null, null, 1, 2, 2]);
    expect(journey.steps[0].label).toBe("Indexed");
  });

  it("names the stage that lost a never-retrieved document, ignoring branch absences", () => {
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA"],
      retrieved_document_ids: ["docB"],
      per_node_funnel: [
        { node_id: "ingestion", document_ids: ["docA"] },
        { node_id: "bm25", document_ids: [] },
        { node_id: "dense", document_ids: ["docA"] },
        { node_id: "fuse", document_ids: ["docA"] },
        { node_id: "out", document_ids: [] },
      ],
    });
    const journey = goldDocJourney("docA", STAGES, item);
    expect(journey.finalRank).toBeNull();
    expect(journey.droppedAt).toBe("Retrieval Output");
  });

  it("reports a never-indexed document as dropped at the first stage", () => {
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA"],
      retrieved_document_ids: [],
      per_node_funnel: [
        { node_id: "ingestion", document_ids: [] },
        { node_id: "dense", document_ids: [] },
      ],
    });
    const journey = goldDocJourney("docA", STAGES, item);
    expect(journey.droppedAt).toBe("Indexed");
  });

  it("skips stages the item has no record for instead of faking a drop", () => {
    const item = makeEvalRunItem({
      per_node_funnel: [{ node_id: "dense", document_ids: ["docA"] }],
    });
    const journey = goldDocJourney("docA", STAGES, item);
    expect(journey.steps).toHaveLength(1);
    expect(journey.steps[0].nodeId).toBe("dense");
  });
});

describe("item summaries", () => {
  it("counts gold hits against the final retrieved set", () => {
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA", "docC"],
      retrieved_document_ids: ["docA", "docB"],
    });
    expect(goldHitCount(item)).toBe(1);
  });

  it("returns the first (best-ranked) chunk for a document", () => {
    const item = makeEvalRunItem();
    expect(bestChunkFor(item, "docB")).toEqual({ chunkId: "uuid-b:0", score: 0.42 });
    expect(bestChunkFor(item, "missing")).toBeNull();
  });
});
